const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // clé serveur

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
