const { main } = require('./src/server');

main().catch((err) => {
  console.error('Ошибка запуска:', err.message);
  process.exit(1);
});
