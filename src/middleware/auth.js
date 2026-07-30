import { verifyJwt } from "../services/auth.service.js";

/* Reads "Authorization: Bearer <token>" and attaches req.user */
export function requireAuth(req, _res, next) {
  /* Normally the token rides in the Authorization header. But a
     plain <a href> download link can't set headers, so we also
     accept ?token=... for those. Header wins if both are present. */
  const header = req.headers.authorization || "";
  const [scheme, headerToken] = header.split(" ");
  const token =
    scheme === "Bearer" && headerToken ? headerToken : req.query.token;

  if (!token) {
    const e = new Error("You need to sign in to do that.");
    e.status = 401;
    return next(e);
  }

  try {
    req.user = verifyJwt(token); // { sub, username, role }
    next();
  } catch {
    const e = new Error("Your session has expired. Sign in again.");
    e.status = 401;
    next(e);
  }
}

/* Gate a route to specific roles: requireRole("admin") */
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
