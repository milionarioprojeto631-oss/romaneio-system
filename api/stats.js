import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const { data: dataParam } = req.query;
    const hoje = dataParam || new Date().toISOString().split('T')[0];

    // Buscar todos os envios do dia
    const { data: envios, error: enviosErr } = await supabase
      .from('envios')
      .select(`
        id, status, nome_cliente, nota_fiscal, iniciado_em, concluido_em,
        itens_envio(quantidade, quantidade_conferida, produto_id)
      `)
      .eq('data_envio', hoje);
    if (enviosErr) throw enviosErr;

    const totalEnvios = envios.length;
    const concluidos = envios.filter(e => e.status === 'concluido').length;
    const emConferencia = envios.filter(e => e.status === 'em_conferencia').length;
    const pendentes = envios.filter(e => e.status === 'pendente').length;

    // Total de itens e SKUs
    let totalItens = 0;
    const skusSet = new Set();
    for (const envio of envios) {
      for (const item of (envio.itens_envio || [])) {
        totalItens += item.quantidade_conferida || 0;
        if (item.produto_id) skusSet.add(item.produto_id);
      }
    }

    // Tempo médio por envio concluído (em minutos)
    let tempoMedio = null;
    const enviosConcluidos = envios.filter(e => e.status === 'concluido' && e.iniciado_em && e.concluido_em);
    if (enviosConcluidos.length > 0) {
      const tempos = enviosConcluidos.map(e => {
        const inicio = new Date(e.iniciado_em).getTime();
        const fim = new Date(e.concluido_em).getTime();
        return (fim - inicio) / 60000;
      });
      tempoMedio = Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length);
    }

    // Progresso geral do dia
    let totalPrevisto = 0;
    let totalConferido = 0;
    for (const envio of envios) {
      for (const item of (envio.itens_envio || [])) {
        totalPrevisto += item.quantidade || 0;
        totalConferido += item.quantidade_conferida || 0;
      }
    }

    return res.json({
      data: hoje,
      resumo: {
        total_envios: totalEnvios,
        concluidos,
        em_conferencia: emConferencia,
        pendentes,
        total_skus: skusSet.size,
        total_itens_embalados: totalItens,
        total_previsto: totalPrevisto,
        total_conferido: totalConferido,
        percentual: totalPrevisto > 0 ? Math.round((totalConferido / totalPrevisto) * 100) : 0,
        tempo_medio_minutos: tempoMedio
      },
      envios: envios.map(e => ({
        id: e.id,
        nome_cliente: e.nome_cliente,
        nota_fiscal: e.nota_fiscal,
        status: e.status,
        total_itens: (e.itens_envio || []).reduce((s, i) => s + i.quantidade, 0),
        itens_conferidos: (e.itens_envio || []).reduce((s, i) => s + i.quantidade_conferida, 0)
      }))
    });

  } catch (err) {
    console.error('[stats]', err);
    return res.status(500).json({ error: err.message || 'Erro interno.' });
  }
}
