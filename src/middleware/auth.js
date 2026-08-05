import { verifyJwt } from "../services/auth.service.js";

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, headerToken] = header.split(" ");
  const token = scheme === "Bearer" && headerToken ? headerToken : req.query.token;
  if (!token) {
    const e = new Error("You need to sign in to do that.");
    e.status = 401;
    return next(e);
  }
  try {
    req.user = verifyJwt(token);
    next();
  } catch {
    const e = new Error("Your session has expired. Sign in again.");
    e.status = 401;
    next(e);
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      const e = new Error("You don't have permission to do that.");
      e.status = 403;
      return next(e);
    }
    next();
  };
}

/* Reads the token IF present and attaches req.user, but never
   blocks the request when it's absent. Used on the public Apply
   route so a logged-in user gets duplicate-checked, while a guest
   can still apply. */
export function attachUser(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, headerToken] = header.split(" ");
  const token =
    scheme === "Bearer" && headerToken ? headerToken : req.query.token;
  if (token) {
    try {
      req.user = verifyJwt(token);
    } catch {
      /* ignore a bad/expired token here — they're applying as a guest */
    }
  }
  next();
}
