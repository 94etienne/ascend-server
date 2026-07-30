export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;

  if (status >= 500) console.error("✗", err.stack || err.message);
  else console.warn("!", err.message);

  res.status(status).json({
    error:
      status === 500 && process.env.NODE_ENV === "production"
        ? "Something went wrong on our end."
        : err.message,
    ...(process.env.NODE_ENV !== "production" &&
      status === 500 && { stack: err.stack }),
  });
}
