const DESIGNERS = [
  'Софа',
  'Шамиль',
  'Настя С',
  'Настя Е',
  'Таня Б',
  'Таня С',
  'Туран',
  'Оля Л',
];

const DEFAULT_AVATAR = '/avatars/Default.png';

function isValidDesigner(name) {
  return typeof name === 'string' && DESIGNERS.includes(name);
}

function validateDesignerPair(responsible, backup) {
  if (!isValidDesigner(responsible) || !isValidDesigner(backup)) {
    return 'Выберите ответственного и страхующего из списка';
  }
  if (responsible === backup) {
    return 'Ответственный и страхующий должны быть разными';
  }
  return null;
}

function defaultDesignerPair(index) {
  const responsible = DESIGNERS[index % DESIGNERS.length];
  const backup = DESIGNERS[(index + 1) % DESIGNERS.length];
  return { responsible, backup };
}

function avatarUrl(name) {
  if (!isValidDesigner(name)) return DEFAULT_AVATAR;
  return `/avatars/${encodeURIComponent(name)}.png`;
}

module.exports = {
  DESIGNERS,
  DEFAULT_AVATAR,
  isValidDesigner,
  validateDesignerPair,
  defaultDesignerPair,
  avatarUrl,
};
