/**
 * Localized rotating motivational messages for the student dashboard (SRS §4.3.1).
 *
 * A new message is shown every day, cycling through the list.
 * Each message has an English and Amharic translation.
 */

export interface MotivationalMessage {
  en: string;
  am: string;
}

export const MOTIVATIONAL_MESSAGES: MotivationalMessage[] = [
  {
    en: "Every quiz you take is a step toward greatness. Keep going!",
    am: "\u12E8\u121D\u1275\u12C8\u1235\u12F0\u12CD \u12E8\u134D\u1270\u1293 \u12A5\u1263\u1265\u12CE\u127D \u12E8\u1235\u12AD\u1234\u1275 \u12B3\u1342\u1278 \u1293\u1278\u12CD\u1362 \u1240\u1325\u120D!",
  },
  {
    en: "Education is the key to unlocking your future.",
    am: "\u1275\u121D\u1215\u122D\u1275 \u12E8\u12CB\u130B\u1205\u1295 \u1260\u122D \u12E8\u121D\u1275\u12A8\u134D\u1275\u1260\u1275 \u1241\u120D\u134D \u1290\u12CD\u1362",
  },
  {
    en: "Success comes from consistent effort. You've got this!",
    am: "\u1235\u12AD\u1234\u1275 \u12A8\u1270\u12A8\u1273\u1273\u12ED \u1325\u1228\u1275 \u12ED\u1218\u1320\u120B\u120D\u1362 \u1275\u127D\u120B\u1208\u1205!",
  },
  {
    en: "Challenge yourself today. Tomorrow you'll thank yourself.",
    am: "\u12D3\u1228 \u122B\u1235\u1205\u1295 \u1270\u1308\u12F3\u12F3\u122D\u1362 \u1290\u1308 \u122B\u1235\u1205\u1295 \u1273\u1218\u1230\u130D\u1293\u1208\u1205\u1362",
  },
  {
    en: "Your streak shows real dedication. Don't break the chain!",
    am: "\u12E8\u1270\u12A8\u1273\u1273\u12ED \u1325\u1228\u1275\u1205 \u12E8\u1215\u1245\u1270\u129B\u1205\u1295 \u1265\u1245\u1290\u1275 \u12EB\u1233\u12EB\u120D\u1362 \u1240\u1325\u120D!",
  },
  {
    en: "Small daily improvements lead to stunning results.",
    am: "\u1275\u1295\u123D \u12E8\u12D8\u1290\u1260\u120D \u1218\u123B\u123B\u120D \u12C8\u12F0 \u1270\u12A0\u121D\u122E \u12CD\u1324\u1275 \u12EB\u12F0\u122D\u1233\u120D\u1362",
  },
  {
    en: "Knowledge is a treasure that follows you everywhere.",
    am: "\u12A5\u12CD\u1240\u1275 \u12E8\u121B\u12ED\u12D8\u1228\u134D \u1205\u1265\u1275 \u1290\u12CD\u1362",
  },
  {
    en: "Believe in your abilities. You are capable of amazing things.",
    am: "\u1260\u127D\u120E\u1273\u1205 \u12A5\u1218\u1295\u1362 \u12A0\u130D\u1228\u121D \u1290\u130D\u122E\u127D\u1295 \u121B\u12F5\u1228\u130D \u1275\u127D\u120B\u1208\u1205\u1362",
  },
  {
    en: "The expert in anything was once a beginner. Keep learning!",
    am: "\u1260\u121B\u1295\u129B\u12CD\u121D \u1218\u1235\u12AD \u12EB\u12C8\u1240\u12CD \u12A8\u1218\u1300\u1218\u122A\u12EB \u1290\u12CD\u1362 \u1218\u121B\u122D\u1205\u1295 \u1240\u1325\u120D!",
  },
  {
    en: "Your hard work will pay off. Stay focused and keep studying!",
    am: "\u1325\u122B\u1275\u1205 \u1270\u1308\u1262\u12CD\u1295 \u12EB\u130B\u12C5\u1205\u120D\u1362 \u1270\u1263\u122D\u122E \u1270\u121B\u122D!",
  },
  {
    en: "Don't compare your beginning to someone else's middle.",
    am: "\u12E8\u1320\u1240\u121D\u12A8\u12CD\u1295 \u1218\u1300\u1218\u122A\u12EB \u12A8\u120C\u120E\u127D \u1218\u12AB\u12A8\u120D \u130B\u122D \u12A0\u1273\u1293\u12DD\u1265\u1362",
  },
  {
    en: "Every correct answer builds your confidence. Well done!",
    am: "\u12E8\u121D\u1275\u1218\u120D\u1230\u12CD \u1275\u12AD\u12AD\u120D \u121D\u120B\u123D \u12E8\u122B\u1235 \u121D\u1245\u1293\u1275\u1205\u1295 \u12ED\u130A\u1263\u120D\u1362",
  },
  {
    en: "Learning is not a race. Go at your own pace and enjoy the journey.",
    am: "\u1275\u121D\u1215\u122D\u1275 \u12CD\u12F5\u12F5\u122D \u12A0\u12ED\u12F0\u1208\u121D\u1362 \u1260\u122B\u1235\u1205 \u134D\u1325\u1290\u1275 \u1239\u12F5 \u12CD\u1320\u12CD\u1295 \u12F0\u1235\u1275\u12BD!",
  },
  {
    en: "Mistakes are proof that you are trying. Learn from them!",
    am: "\u1235\u1205\u1270\u1276\u127D \u12E8\u121D\u1275\u121E\u12AD\u122D \u121B\u1235\u1228\u1303 \u1293\u1278\u12CD\u1362 \u12A8\u1230\u121D \u1270\u121B\u122D!",
  },
  {
    en: "Set your goals high and don't stop until you reach them.",
    am: "\u130D\u1265\u1205\u1295 \u12A8\u134D\u1270\u129B \u12A0\u12F5\u122D\u130D\u1362 \u12A5\u1235\u12AD\u1275\u12F0\u122D\u1235 \u12A0\u1273\u1241\u121D!",
  },
  {
    en: "You are one quiz away from a new personal record!",
    am: "\u12A0\u1295\u12F5 \u134D\u1270\u1293 \u1265\u127B \u12ED\u1240\u122D\u1205\u120D \u12A5\u1293 \u12A0\u12F2\u1235 \u12E8\u130D\u120D \u1235\u12AD\u1234\u1275 \u1275\u1218\u12D8\u130D\u1263\u1208\u1205!",
  },
  {
    en: "The more you practice, the luckier you get on exam day.",
    am: "\u1260\u1260\u120D\u1325 \u1270\u1218\u122B\u1218\u122D\u12BD \u1260\u134D\u1270\u1293 \u1240\u1295 \u12E8\u1260\u1208\u1325 \u1275\u1233\u12AB\u1208\u1205\u1362",
  },
  {
    en: "Great things never come from comfort zones. Push your limits!",
    am: "\u1275\u120D\u120D\u1245 \u1295\u130D\u122E\u127D \u12A8\u121D\u127D\u1275 \u1245\u120D\u120D \u12A0\u12ED\u1218\u1320\u1229\u121D\u1362 \u12F0\u1228\u1303\u1205\u1295 \u130D\u1320\u1325\u1320\u1325!",
  },
  {
    en: "Today's effort is tomorrow's excellence.",
    am: "\u12E8\u12D3\u1228\u12CD \u1325\u1228\u1275 \u12E8\u1290\u1308\u12CD \u1265\u1241\u1290\u1275 \u1290\u12CD\u1362",
  },
  {
    en: "You've already proven you can do this. Now aim even higher!",
    am: "\u12ED\u1205\u1295 \u121B\u12F5\u1228\u130D \u12A5\u1295\u12F0\u121D\u1275\u127D\u120D \u12A0\u12E8\u1205 \u12A0\u1235\u1218\u1235\u12AD\u122D\u12BD\u120D\u1362 \u12A0\u1201\u1295 \u12A8\u134D \u120B\u12ED \u12A0\u1245\u1293!",
  },
];

/**
 * Returns the motivational message for today. The message changes once per
 * calendar day (based on the day-of-year).
 */
export function getDailyMessage(): MotivationalMessage {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (now.getTime() - start.getTime()) / 86_400_000
  );
  return MOTIVATIONAL_MESSAGES[dayOfYear % MOTIVATIONAL_MESSAGES.length];
}
