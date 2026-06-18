import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET /api/produtos?barras=xxx  ou  GET /api/produtos?id=xxx  ou  GET /api/produtos (lista)
    if (req.method === 'GET') {
      const { barras, id, q } = req.query;

      if (barras) {
        const { data, error } = await supabase
          .from('produtos')
          .select('*')
          .eq('codigo_barras', barras)
          .single();
        if (error && error.code !== 'PGRST116') throw error;
        return res.json({ produto: data || null });
      }

      if (id) {
        const { data, error } = await supabase
          .from('produtos')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;
        return res.json({ produto: data });
      }

      let query = supabase.from('produtos').select('*').order('created_at', { ascending: false });
      if (q) {
        query = query.or(`descricao.ilike.%${q}%,codigo_barras.ilike.%${q}%,codigo_interno.ilike.%${q}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return res.json({ produtos: data });
    }

    // POST /api/produtos — criar
    if (req.method === 'POST') {
      const { codigo_barras, descricao, codigo_interno, an } = req.body;
      if (!codigo_barras || !descricao) {
        return res.status(400).json({ error: 'codigo_barras e descricao são obrigatórios.' });
      }

      // Verificar duplicidade
      const { data: existe } = await supabase
        .from('produtos')
        .select('id')
        .eq('codigo_barras', codigo_barras)
        .single();
      if (existe) return res.status(409).json({ error: 'Código de barras já cadastrado.' });

      const { data, error } = await supabase
        .from('produtos')
        .insert([{ codigo_barras, descricao, codigo_interno, an }])
        .select()
        .single();
      if (error) throw error;
      return res.status(201).json({ produto: data });
    }

    // PUT /api/produtos?id=xxx — editar
    if (req.method === 'PUT') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id obrigatório.' });
      const { codigo_barras, descricao, codigo_interno, an } = req.body;

      const { data, error } = await supabase
        .from('produtos')
        .update({ codigo_barras, descricao, codigo_interno, an })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.json({ produto: data });
    }

    // DELETE /api/produtos?id=xxx
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id obrigatório.' });
      const { error } = await supabase.from('produtos').delete().eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método não permitido.' });

  } catch (err) {
    console.error('[produtos]', err);
    return res.status(500).json({ error: err.message || 'Erro interno.' });
  }
}
