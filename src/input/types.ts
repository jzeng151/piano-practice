export type InputEvent =
  | { type: 'note'; on: boolean; midi: number; velocity: number; timestamp: number }
  | { type: 'pedal'; down: boolean; timestamp: number };

export interface InputSource {
  subscribe(listener: (e: InputEvent) => void): () => void;
  attach(): void;
  detach(): void;
}
