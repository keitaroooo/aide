/* eslint-disable */
// Minimal AI binding stub for local typecheck
interface AiModels {
  [model: string]: unknown;
}
declare abstract class Ai {
  run(model: keyof AiModels, inputs: unknown): Promise<unknown>;
}
