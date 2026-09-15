export {
  registerSchema,
  loginSchema,
  refreshSchema,
  recoverySchema,
  type RegisterInput,
  type LoginInput,
  type RefreshInput,
  type RecoveryInput,
} from "./auth/index.js";
export { createDocumentSchema, type CreateDocumentInput } from "./documents/index.js";
export { listShopsQuerySchema, type ListShopsQueryInput } from "./shops/index.js";
