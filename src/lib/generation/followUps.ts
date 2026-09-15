import 'server-only';
import { generateFollowUpQuestions } from '@/lib/providers/openai';

export async function generateFollowUps({
  question,
  answer,
  passages,
}: {
  question?: string;
  answer: string;
  passages: string;
}): Promise<string[]> {
  try {
    return await generateFollowUpQuestions({
      system:
        'Based on the passages, the answer given, and (if provided) the question asked, ' +
        'suggest exactly 3 short, specific follow-up questions the user could ask next. ' +
        'Only suggest questions answerable from the passages.',
      prompt: [
        question ? `Question: ${question}` : null,
        `Answer: ${answer}`,
        `Passages:\n${passages}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
  } catch (err) {
    console.error('follow-up generation failed', err);
    return [];
  }
}
