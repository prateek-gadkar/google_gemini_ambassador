// ===========================================================================
//  EDIT THIS FILE. Everything the site says about your event lives here.
//
//  Any field left as an empty string is treated as "not supplied yet": the
//  certificate download stays disabled and the UI shows what is missing,
//  rather than filling the gap with guesswork.
// ===========================================================================

export const CONFIG = {
  // Neutral name for the tool itself. Not an official Google word.
  siteName: 'Certificate Station',
  tagline: 'Complete every required task, then collect your certificate.',

  // --- Your event -----------------------------------------------------------
  // Blank until you supply the exact wording. Nothing here is auto-filled.
  event: {
    title: '',        // e.g. exactly as it should print
    date: '',         // e.g. exactly as it should print
    campus: '',       // e.g. exactly as it should print
    ambassador: '',   // name as it should appear, if the template has this field
    gid: '13597',     // confirmed
  },

  // --- The gate -------------------------------------------------------------
  // A student unlocks the certificate when every task with required:true is
  // verified. Add or remove entries freely; the UI and the gate both follow.
  tasks: [
    {
      key: 'pre',
      label: 'Pre-survey form',
      required: true,
      hint: 'Fill the pre-survey linked in the portal, then paste your confirmation below.',
      formUrl: '', // paste the exact pre-survey link you gave students
      proofRequired: false,
    },
    {
      key: 'post',
      label: 'Post-survey form',
      required: true,
      hint: 'Fill the post-survey linked in the portal, then paste your confirmation below.',
      formUrl: '', // paste the exact post-survey link you gave students
      proofRequired: false,
    },
  ],

  // Receipts count as verified the moment they are submitted. An admin can
  // still mark a receipt rejected afterwards, which re-locks the certificate.
  autoVerifyReceipts: true,

  // Official participant ceiling for the Game On Night session.
  maxStudents: 100,

  // Flood guard only. Deliberately generous: an entire campus usually shares
  // one public IP, so a low per-IP cap would lock out the whole room.
  rateLimit: { windowMinutes: 10, perIp: 240 },
};
