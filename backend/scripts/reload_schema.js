const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
client.connect()
  .then(() => client.query(`NOTIFY pgrst, 'reload schema'`))
  .then(() => client.end())
  .then(() => console.log('Reloaded schema cache!'))
  .catch(console.error);
