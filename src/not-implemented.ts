/**
 * Thrown by exercise skeletons where the participant's code goes. The
 * message carries the exercise and step so `pnpm check:NN` can name them.
 */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}
