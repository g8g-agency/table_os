import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function check() {
    const token = "OWY4YjJiMmUtYTRlMy00MDcyLWE5ZDEtMDA5ZjQyY2UxMjExOjA2NDRiN2ZmLWM1YTUtNGMxZC05YTk1LWRlMjI5MTVlMzdmOTozNTgxN2JlZC1mMTRmLTRjZmYtYjUxMC0yNDdhOGE3NDBiZWI6NjE2NzJhNzZiNmRk";
    console.log("Checking token:", token);
    const { data: tableRow, error } = await supabase
        .from('tables')
        .select('id, tenant_id, qr_token, deleted_at, is_active')
        .eq('qr_token', token)
        .maybeSingle();

    console.log("Table Row Exact Match:", tableRow, error);

    if (!tableRow) {
        // Maybe it decodes?
        try {
            const raw = Buffer.from(token, 'base64url').toString('utf8');
            console.log("Decoded:", raw);
            const [tableId] = raw.split(':');
            const { data: tableById } = await supabase
                .from('tables')
                .select('id, qr_token, is_active')
                .eq('id', tableId)
                .maybeSingle();
            console.log("Table by decoded ID:", tableById);
        } catch (e) {
            console.error("Decode error", e);
        }
    }
}

check();
