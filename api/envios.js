import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET /api/envios?data=YYYY-MM-DD  |  ?id=xxx  |  lista
    if (req.method === 'GET') {
      const { data: dataFiltro, id, status } = req.query;

      if (id) {
        const { data, error } = await supabase
          .from('envios')
          .select(`*, itens_envio(*, produtos(*))`)
          .eq('id', id)
          .single();
        if (error) throw error;
        return res.json({ envio: data });
      }

      let query = supabase
        .from('envios')
        .select(`*, itens_envio(id, quantidade, quantidade_conferida, descricao_manual, produtos(descricao, codigo_barras))`)
        .order('created_at', { ascending: false });

      if (dataFiltro) query = query.eq('data_envio', dataFiltro);
      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;
      return res.json({ envios: data });
    }

    // POST /api/envios — criar envio manual
    if (req.method === 'POST') {
      const { nome_cliente, nota_fiscal, itens } = req.body;
      if (!nome_cliente) return res.status(400).json({ error: 'nome_cliente obrigatório.' });

      const { data: envio, error } = await supabase
        .from('envios')
        .insert([{
          nome_cliente,
          nota_fiscal: nota_fiscal || null,
          data_envio: new Date().toISOString().split('T')[0],
          status: 'pendente'
        }])
        .select()
        .single();
      if (error) throw error;

      if (itens && itens.length > 0) {
        const itensData = itens.map(i => ({
          envio_id: envio.id,
          produto_id: i.produto_id || null,
          descricao_manual: i.descricao_manual || null,
          quantidade: i.quantidade || 1,
          quantidade_conferida: 0
        }));
        await supabase.from('itens_envio').insert(itensData);
      }

      return res.status(201).json({ envio });
    }

    // PUT /api/envios?id=xxx — atualizar status
    if (req.method === 'PUT') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id obrigatório.' });
      const updates = req.body;

      const { data, error } = await supabase
        .from('envios')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.json({ envio: data });
    }

    // DELETE /api/envios?id=xxx
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id obrigatório.' });
      const { error } = await supabase.from('envios').delete().eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método não permitido.' });

  } catch (err) {
    console.error('[envios]', err);
    return res.status(500).json({ error: err.message || 'Erro interno.' });
  }
}
