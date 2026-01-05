export class ActorAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`Actor with id "${id}" already exists`);
    this.name = "ActorAlreadyExistsError";
  }
}
