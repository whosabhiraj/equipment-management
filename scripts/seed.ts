import * as fs from 'fs';
import * as path from 'path';

function generateSeed() {
  const rosterPath = fs.existsSync(path.resolve('data/roster.csv'))
    ? path.resolve('data/roster.csv')
    : path.resolve('data/roster.example.csv');

  console.log(`Reading roster from: ${rosterPath}`);
  const csvContent = fs.readFileSync(rosterPath, 'utf-8');
  const lines = csvContent.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Skip header line
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1);

  let sqlStatements: string[] = [];

  // Enable foreign keys
  sqlStatements.push('PRAGMA foreign_keys = ON;');
  
  // Clean old seeds (excluding users created via other means, but for clean local we clean booking and catalogs)
  sqlStatements.push('DELETE FROM bookings;');
  sqlStatements.push('DELETE FROM blackouts;');
  sqlStatements.push('DELETE FROM items;');
  sqlStatements.push('DELETE FROM categories;');
  sqlStatements.push('DELETE FROM sessions;');
  sqlStatements.push('DELETE FROM accounts;');
  sqlStatements.push('DELETE FROM users;');

  // Insert Users
  console.log(`Processing ${rows.length} users...`);
  const now = new Date();
  
  rows.forEach((row) => {
    const cols = row.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 3) return;
    const [email, name, roomNo] = cols;
    
    // Auto assign roles based on keyword/email
    let role = 'resident';
    if (email.includes('admin')) {
      role = 'admin';
    } else if (email.includes('rep')) {
      role = 'rep';
    }

    const id = `usr_${Math.random().toString(36).substring(2, 11)}`;
    const timestamp = now.getTime();
    
    sqlStatements.push(
      `INSERT INTO users (id, email, name, image, role, room_no, disabled, created_at, updated_at) VALUES ` +
      `('${id}', '${email}', '${name.replace(/'/g, "''")}', NULL, '${role}', '${roomNo.replace(/'/g, "''")}', 0, ${timestamp}, ${timestamp});`
    );
  });

  // Insert Categories
  sqlStatements.push(
    `INSERT INTO categories (id, name, sort_order) VALUES ('cat_1', 'Racquet Sports', 1);`,
    `INSERT INTO categories (id, name, sort_order) VALUES ('cat_2', 'Board Games', 2);`,
    `INSERT INTO categories (id, name, sort_order) VALUES ('cat_3', 'Field Sports', 3);`
  );

  // Insert Items
  const itemsToSeed = [
    { id: 'itm_badminton', catId: 'cat_1', name: 'Badminton Racquet', qty: 4, reqApproval: 1, maxSlots: 2, desc: 'Yonex Carbonex carbon fibre racquet. Court shoes required.' },
    { id: 'itm_tt', catId: 'cat_1', name: 'Table Tennis Paddle', qty: 6, reqApproval: 0, maxSlots: 2, desc: 'Stiga 3-star table tennis bat. Balls available at counter.' },
    { id: 'itm_catan', catId: 'cat_2', name: 'Catan (5th Edition)', qty: 2, reqApproval: 0, maxSlots: 3, desc: 'Classic board game. 3-4 players. Contains all expansion pieces.' },
    { id: 'itm_chess', catId: 'cat_2', name: 'Chess Set', qty: 5, reqApproval: 0, maxSlots: 2, desc: 'Standard wooden chess board with weighted pieces.' },
    { id: 'itm_football', catId: 'cat_3', name: 'Nivia Football', qty: 3, reqApproval: 1, maxSlots: 2, desc: 'Size 5 training football. Return inflated.' },
  ];

  itemsToSeed.forEach((item, index) => {
    const timestamp = now.getTime();
    sqlStatements.push(
      `INSERT INTO items (id, category_id, name, description, image_url, quantity, active, requires_approval, max_slots_per_booking, earliest_slot, latest_slot, advance_days, sort_order, created_at) VALUES ` +
      `('${item.id}', '${item.catId}', '${item.name}', '${item.desc.replace(/'/g, "''")}', NULL, ${item.qty}, 1, ${item.reqApproval}, ${item.maxSlots}, 0, 17, 7, ${index + 1}, ${timestamp});`
    );
  });

  // Create Migrations Dir if not exists
  // NOT in migrations/ — this file truncates every table, and anything in
  // migrations/ is executed by `wrangler d1 migrations apply --remote`, which
  // §10 runs in CI before every production deploy.
  const outDir = path.resolve('scripts');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
  }

  // Write SQL script
  fs.writeFileSync(path.join(migrationsDir, 'seed.sql'), sqlStatements.join('\n'));
  console.log(`Seeding SQL generated successfully at: ${path.join(outDir, 'seed.sql')}`);
}

generateSeed();
