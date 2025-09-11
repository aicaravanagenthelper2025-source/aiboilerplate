const WINDOW_MS = 60_000; // 1 min window
const MAX_REQS = Number(process.env.RATE_LIMIT || 30);
const BUCKET = new Map();
export function ensurePasscode(req, res, next) {
    const expected = process.env.PASSCODE;
    if (!expected)
        return next(); // disabled
    const header = String(req.headers["x-passcode"] || req.query.passcode || req.body?.passcode || "");
    if (header !== expected)
        return res.status(401).json({ error: "No autorizado (passcode)" });
    next();
}
export function rateLimit(req, res, next) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "anon";
    const now = Date.now();
    const slot = BUCKET.get(ip) || { count: 0, start: now };
    if (now - slot.start > WINDOW_MS) {
        slot.count = 0;
        slot.start = now;
    }
    slot.count += 1;
    BUCKET.set(ip, slot);
    if (slot.count > MAX_REQS)
        return res.status(429).json({ error: "Rate limit excedido" });
    next();
}
