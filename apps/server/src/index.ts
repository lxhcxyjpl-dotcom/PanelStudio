import {
  registerAjvFormats,
  TypeBoxValidatorCompiler,
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
import Fastify from "fastify";

/**
 * Fastify instance with the TypeBox validator wired.
 * Phase 0 does not register product routes. The HTTP contract is docs/openapi.json.
 */
export function createServer() {
  registerAjvFormats();
  return Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>().setValidatorCompiler(
    TypeBoxValidatorCompiler,
  );
}
