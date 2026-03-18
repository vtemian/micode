// src/octto/session/utils.ts
// ID generation utilities for octto sessions and questions

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 8;

function generateId(prefix: string): string {
  let id = `${prefix}_`;
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
  }
  return id;
}

export function generateSessionId(): string {
  return generateId("ses");
}

export function generateQuestionId(): string {
  return generateId("q");
}

export function generateBrainstormId(): string {
  return generateId("bs");
}
