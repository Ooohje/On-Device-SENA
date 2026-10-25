// 작은 모델이 자주 섞는 형식 요소를 지워서 화면 표시와 TTS에 바로 쓸 수 있게 만든다.
export function cleanReply(text: string, partnerName: string, learner: string, maxSentences = 3): string {
  let t = text.trim();
  // 역할 접두어 ("Mia:", "**Jake:**")
  const prefix = new RegExp(`^\\**\\s*(${escape(partnerName)}|assistant|AI)\\s*\\**\\s*:\\s*`, 'i');
  t = t.replace(prefix, '');
  // 모델이 학습자 대사까지 이어 쓴 경우 그 앞에서 자른다
  const userTurn = new RegExp(`\\n+\\s*\\**\\s*(${escape(learner)}|user|learner)\\s*\\**\\s*:`, 'i');
  const cut = t.search(userTurn);
  if (cut > 0) t = t.slice(0, cut);
  t = t
    .replace(/\[[^\]\n]*\]?/g, ' ') // 엔진이 붙인 턴 지시를 모델이 따라 쓴 경우
    .replace(/\*[^*\n]{1,40}\*/g, ' ') // *smiles*
    .replace(/\([^)\n]{1,40}\)/g, (m) => (/[a-z]/i.test(m) && /smil|laugh|nod|paus|wink/i.test(m) ? ' ' : m)) // (smiles)
    .replace(/[*_#`>]+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^["“](.*)["”]$/, '$1');
  return limitSentences(t, maxSentences);
}

export function limitSentences(t: string, max: number): string {
  const parts = t.match(/[^.!?]+[.!?]+["”']?|[^.!?]+$/g);
  if (!parts || parts.length <= max) return t;
  // 질문으로 끝내는 규칙을 지키도록, 잘린 뒤에 질문이 있었다면 마지막 질문을 살린다
  const kept = parts.slice(0, max);
  const lastQ = [...parts].reverse().find((p) => p.trim().endsWith('?'));
  if (lastQ && !kept.some((p) => p.trim().endsWith('?'))) kept[max - 1] = lastQ;
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

export function cleanOneLine(text: string): string {
  return text
    .trim()
    .replace(/^(summary|reply|answer)\s*:\s*/i, '')
    .replace(/[*_#`]+/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/^["“](.*)["”]$/, '$1')
    .trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
