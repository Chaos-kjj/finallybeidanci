const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.KANGKANG_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.KANGKANG_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const stateTable = process.env.KANGKANG_SUPABASE_STATE_TABLE || 'user_app_state';
const readerBooksTable = process.env.KANGKANG_SUPABASE_READER_BOOKS_TABLE || 'user_reader_books';

const output = [
  `window.KANGKANG_SUPABASE_URL = ${JSON.stringify(supabaseUrl)};`,
  `window.KANGKANG_SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)};`,
  `window.KANGKANG_SUPABASE_STATE_TABLE = ${JSON.stringify(stateTable)};`,
  `window.KANGKANG_SUPABASE_READER_BOOKS_TABLE = ${JSON.stringify(readerBooksTable)};`,
  ''
].join('\n');

fs.writeFileSync(path.join(__dirname, 'supabase-config.js'), output, 'utf8');
console.log('Generated deploy/supabase-config.js');
