import { AppError } from '../lib/errors.js';

export function validate(schemas) {
  return (req, _res, next) => {
    const parsedValues = {};
    const issues = [];

    for (const [location, schema] of Object.entries(schemas)) {
      if (!schema) {
        continue;
      }

      const result = schema.safeParse(req[location]);
      if (!result.success) {
        issues.push(
          ...result.error.issues.map((issue) => ({
            path: [location, ...issue.path].join('.'),
            message: issue.message
          }))
        );
      } else {
        parsedValues[location] = result.data;
      }
    }

    if (issues.length > 0) {
      return next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request', issues));
    }

    for (const [location, value] of Object.entries(parsedValues)) {
      Object.defineProperty(req, location, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      });
    }

    return next();
  };
}
