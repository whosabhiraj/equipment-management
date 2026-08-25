import { getSlotTimeRange } from '../shared/slots';
import { getDb } from './db/client';
import { auditLog } from './db/schema';

type DecisionEmailProps = {
  recipientEmail: string;
  recipientName: string;
  itemName: string;
  slotDate: string;
  slotIndices: number[];
  status: 'approved' | 'declined' | 'cancelled';
  declineReason?: string | null;
  deciderName: string;
  actorId: string;
};

export async function sendDecisionEmail(
  env: { RESEND_API_KEY?: string; NOTIFY_ENABLED?: string; DB: D1Database },
  props: DecisionEmailProps
): Promise<boolean> {
  const isEnabled = env.NOTIFY_ENABLED === 'true';
  const apiKey = env.RESEND_API_KEY;

  if (!isEnabled || !apiKey) {
    console.log(`Email notification skipped (disabled or no key): ${props.status.toUpperCase()} for ${props.recipientEmail}`);
    return false;
  }

  try {
    const formattedSlots = props.slotIndices
      .map(idx => getSlotTimeRange(idx))
      .join(', ');

    const subjectStatus = props.status === 'approved' ? 'Approved' : props.status === 'declined' ? 'Declined' : 'Cancelled';
    const subject = `${subjectStatus} — ${props.itemName}, ${props.slotDate} (${formattedSlots})`;

    let bodyText = `Hi ${props.recipientName},\n\n`;
    
    if (props.status === 'approved') {
      bodyText += `Your booking request for "${props.itemName}" on ${props.slotDate} at slot(s) [${formattedSlots}] has been APPROVED by ${props.deciderName}.\n\n`;
      bodyText += `Please collect the equipment from the sports room at the start of your slot.`;
    } else if (props.status === 'declined') {
      bodyText += `Your booking request for "${props.itemName}" on ${props.slotDate} at slot(s) [${formattedSlots}] was DECLINED by ${props.deciderName}.\n\n`;
      if (props.declineReason) {
        bodyText += `Reason provided: "${props.declineReason}"\n\n`;
      }
      bodyText += `You can check availability and request another slot on the booking portal.`;
    } else {
      bodyText += `Your booking for "${props.itemName}" on ${props.slotDate} at slot(s) [${formattedSlots}] has been CANCELLED by rep ${props.deciderName}.\n\n`;
      if (props.declineReason) {
        bodyText += `Reason provided: "${props.declineReason}"\n\n`;
      }
    }

    bodyText += `\n\nBest regards,\nHostel Sports Committee`;

    // Resend REST API Send Email Endpoint
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hostel Sports <noreply@resend.dev>', // Resend verified test address, or customized if domain verified
        to: [props.recipientEmail],
        subject: subject,
        text: bodyText,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Resend API returned status ${res.status}: ${errText}`);
    }

    console.log(`Email sent successfully to ${props.recipientEmail}`);
    return true;
  } catch (error: any) {
    console.error(`Failed to send email notification to ${props.recipientEmail}:`, error);
    
    // Failures must never break the booking flow. We wrap in try/catch and log to the audit log.
    try {
      const db = getDb(env.DB);
      const logId = `aud_${Math.random().toString(36).substring(2, 11)}`;
      await db.insert(auditLog).values({
        id: logId,
        actorId: props.actorId,
        action: 'email_failure',
        targetType: 'booking',
        targetId: 'system',
        metaJson: JSON.stringify({
          recipient: props.recipientEmail,
          error: error?.message || String(error),
          status: props.status,
          item: props.itemName,
          date: props.slotDate,
          slots: props.slotIndices
        }),
        createdAt: new Date(),
      });
    } catch (dbErr) {
      console.error('Failed to log email failure to audit log:', dbErr);
    }
    
    return false;
  }
}
