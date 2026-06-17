let figmaAuthed = false;
let googleAuthed = false;

function setFigmaAuth(value) {
  figmaAuthed = Boolean(value);
}

function setGoogleAuth(value) {
  googleAuthed = Boolean(value);
}

function resetAuthState() {
  figmaAuthed = false;
  googleAuthed = false;
}

function getAuthStatus() {
  const figma = {
    ok: figmaAuthed,
    label: figmaAuthed ? 'Авторизован' : 'Нужен вход',
    hint: figmaAuthed ? 'Можно делать бэкап' : 'Войдите через Chrome',
  };
  const google = {
    ok: googleAuthed,
    label: googleAuthed ? 'Авторизован' : 'Нужен вход',
    hint: googleAuthed ? 'Можно делать бэкап' : 'Войдите через Chrome',
  };

  return {
    ready: figmaAuthed && googleAuthed,
    figma,
    google,
    hint: 'Перед бэкапом войдите в Figma и Google Drive в одном окне Chrome. Не закрывайте его до завершения бэкапа.',
  };
}

module.exports = {
  setFigmaAuth,
  setGoogleAuth,
  resetAuthState,
  getAuthStatus,
};
