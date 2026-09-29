// The same completion rule runs in the profile UI and on the server.
export const PROFILE_EXPLANATION_MIN = 60;
export const PROFILE_EXPLANATIONS = {
  debtPurposeOther: {
    label: 'На что потратили кредитные деньги и почему возникли долги?',
    prompt: 'Опишите основные цели: что оплатили или купили, кто пользовался деньгами и почему понадобился кредит. Если погашали прежние долги, уточните какие. Один общий ответ по всем кредитам.',
  },
  n12008: {
    label: 'Что изменилось, когда и почему стало трудно платить?',
    prompt: 'Укажите событие и месяц/год, как изменились доходы или обязательные расходы и почему денег стало не хватать на платежи. Запишите конкретные факты со слов клиента.',
  },
};
export function explanationText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}
export function explanationLength(value) {
  return Array.from(explanationText(value)).length;
}
export function explanationError(value) {
  const text = explanationText(value);
  if (/^(?:(?:не\s+знаю|неизвестно|unknown|idk|уточнить\s+позже)[\s.,;:!?—-]*)+$/iu.test(text)) {
    return 'Уточните факты у клиента и напишите объяснение — минимум 60 символов.';
  }
  const length = explanationLength(text);
  return length < PROFILE_EXPLANATION_MIN
    ? `Минимум ${PROFILE_EXPLANATION_MIN} символов, сейчас ${length}. Дополните объяснение фактами.`
    : null;
}
