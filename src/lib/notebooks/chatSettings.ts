export type ChatStyle = 'default' | 'custom';
export type ChatAnswerLength = 'shorter' | 'default' | 'longer';

export interface ChatSettings {
  chatStyle: ChatStyle;
  chatCustomStyle: string | null;
  chatAnswerLength: ChatAnswerLength;
}

export const MAX_CUSTOM_STYLE_LENGTH = 10000;
export const CHAT_STYLES: ChatStyle[] = ['default', 'custom'];
export const CHAT_ANSWER_LENGTHS: ChatAnswerLength[] = ['shorter', 'default', 'longer'];
