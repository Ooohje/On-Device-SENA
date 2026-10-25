// 영어 이름 규칙: 영문자로 시작, 영문자·공백·하이픈·아포스트로피·마침표, 1~20자. 단어 첫 글자는 대문자로.
export function normalizeEnglishName(input: string): { ok: true; name: string } | { ok: false; reason: string } {
  const t = input.trim().replace(/\s+/g, ' ');
  if (!t) return { ok: false, reason: '이름을 입력해 주세요.' };
  if (/[가-힣ㄱ-ㆎ]/.test(t)) return { ok: false, reason: '영어로 입력해 주세요. 예: Jason, Minji' };
  if (!/^[A-Za-z][A-Za-z .'-]{0,19}$/.test(t)) return { ok: false, reason: '영문자로 시작하는 20자 이내의 이름을 입력해 주세요.' };
  const name = t.replace(/(^|[ -])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
  return { ok: true, name };
}
