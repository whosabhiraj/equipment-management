import { z } from 'zod';

// Adding one person to the hostel
export const userImportSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  roomNo: z.string().min(1, "Room number is required"),
  role: z.enum(['resident', 'rep', 'admin']).default('resident'),
}).strict();

// Category validation
export const categorySchema = z.object({
  name: z.string().min(1, "Category name is required").max(50),
  sortOrder: z.number().int().default(0),
}).strict();

// Item validation
export const itemSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  name: z.string().min(2, "Item name is required").max(100),
  description: z.string().max(500).optional().nullable(),
  imageUrl: z.string().url().or(z.literal("")).optional().nullable(),
  quantity: z.number().int().nonnegative("Quantity cannot be negative").default(1),
  active: z.boolean().default(true),
  requiresApproval: z.boolean().default(true),
  maxSlotsPerBooking: z.number().int().min(1).max(18).default(2),
  earliestSlot: z.number().int().min(0).max(17).default(0),
  latestSlot: z.number().int().min(0).max(17).default(17),
  advanceDays: z.number().int().min(1).max(30).default(7),
  sortOrder: z.number().int().default(0),
}).strict().refine(data => data.latestSlot >= data.earliestSlot, {
  message: "Latest slot index must be greater than or equal to earliest slot index",
  path: ["latestSlot"],
});

// Booking request validation
export const bookingRequestSchema = z.object({
  itemId: z.string().min(1, "Item ID is required"),
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  slotIndices: z.array(z.number().int().min(0).max(17)).min(1, "At least one slot must be selected"),
  note: z.string().max(500).optional().nullable(),
}).strict().refine(data => {
  // Check if slot indices are consecutive
  const sorted = [...data.slotIndices].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      return false;
    }
  }
  return true;
}, {
  message: "Selected slots must be consecutive",
  path: ["slotIndices"],
});

// Blackout validation
export const blackoutSchema = z.object({
  itemId: z.string().optional().nullable(), // Null = global blackout
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  slotIndex: z.number().int().min(0).max(17).optional().nullable(), // Null = whole day
  reason: z.string().min(3, "Reason must be at least 3 characters").max(200),
}).strict();

// User Update validation
export const userUpdateSchema = z.object({
  role: z.enum(['resident', 'rep', 'admin']),
  roomNo: z.string().optional().nullable(),
  disabled: z.boolean(),
}).strict();

// Rep/admin approve-or-decline payload
export const decisionSchema = z.object({
  bookingId: z.string().min(1, "Booking id is required"),
  decision: z.enum(['approved', 'declined']),
  declineReason: z.string().max(200).optional().nullable(),
}).strict();

// Confirmed bulk add
export const bulkAddPeopleSchema = z.object({
  items: z.array(z.object({
    email: z.string().email().toLowerCase(),
    name: z.string().min(1, "Name is required"),
    roomNo: z.string().min(1, "Room number is required"),
  }).strict()).min(1, "No user records provided for import").max(1000),
}).strict();
