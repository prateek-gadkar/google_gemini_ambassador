// ===========================================================================
//  EDIT THIS FILE. Everything the site says about your event lives here.
//
//  The certificate artwork already contains all the official wording (event
//  title, the paragraph, the Google and GSA marks), so this app prints only
//  the three blanks the template leaves: the student's name, the date, and
//  your signature. Nothing else is added to the certificate.
// ===========================================================================

export const CONFIG = {
  // Neutral name for the tool itself. Not an official Google word.
  siteName: 'Certificate Station',
  tagline: 'Complete every required task, then collect your certificate.',

  // Recorded for reference only. The certificate prints these from the
  // artwork, so changing them here does not change the certificate.
  event: {
    title: 'Game On: Imagine the Impossible',
    gid: '13597',
  },

  // --- How the date is written on the certificate --------------------------
  // Change these two lines to change the format. Examples:
  //   { day: 'numeric', month: 'long',  year: 'numeric' }  ->  15 November 2026
  //   { day: '2-digit', month: '2-digit', year: 'numeric' } ->  15/11/2026
  //   { day: 'numeric', month: 'short', year: 'numeric' }   ->  15 Nov 2026
  dateFormat: {
    locale: 'en-GB',
    options: { day: 'numeric', month: 'long', year: 'numeric' },
  },

  // --- The gate -------------------------------------------------------------
  // A student unlocks the certificate when every task with required:true is
  // verified. Add or remove entries freely; the UI and the gate both follow.
  tasks: [
    {
      key: 'pre',
      label: 'Pre-survey form',
      required: true,
      hint: 'Open the form, fill it in, then paste the confirmation you get at the end below.',
      formUrl: 'https://producttrialsurvey.geministudentambassador.com/',
      proofRequired: false,
    },
    {
      key: 'post',
      label: 'Post-survey form',
      required: true,
      hint: 'Open the form, fill it in, then paste the confirmation you get at the end below.',
      formUrl: 'https://producttrialfeedback.geministudentambassador.com/',
      proofRequired: false,
    },
  ],

  // false = a submitted receipt is only a claim. The organiser opens /admin and
  // presses Verify for that student; until then the certificate stays locked.
  // Set this to true to let submissions unlock by themselves again.
  autoVerifyReceipts: false,

  // Official participant ceiling for the Game On Night session.
  maxStudents: 100,

  // Flood guard only. Deliberately generous: an entire campus usually shares
  // one public IP, so a low per-IP cap would lock out the whole room.
  rateLimit: { windowMinutes: 10, perIp: 240 },
};
