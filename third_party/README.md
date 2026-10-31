# Attribution

`electron/retry-policy.cjs` is adapted from the Apache-2.0 licensed Rakazo component in [Arcada](https://github.com/vedantagarwal-web/arcada-worktrial/blob/d2d90fb996498d61a93cb90169149baf15df3686/product/rakazo/packages/core/src/retry-policy.ts).

Changes: TypeScript exports converted to CommonJS. Original license: [rakazo-LICENSE](rakazo-LICENSE). The Odoo integration restricts retries to known reads; mutations and authentication are never automatically retried.
