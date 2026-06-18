import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const { envio_id, codigo_barras } = req.body;
    if (!envio_id || !codigo_barras) {
      return res.status(400).json({ error: 'envio_id e codigo_barras são obrigatórios.' });
    }

    // Buscar produto pelo código de barras
    const { data: produto, error: prodErr } = await supabase
      .from('produtos')
      .select('*')
      .eq('codigo_barras', codigo_barras)
      .single();

    if (prodErr || !produto) {
      await supabase.from('log_bipagem').insert([{
        envio_id,
        codigo_barras,
        resultado: 'erro'
      }]);
      return res.status(404).json({
        ok: false,
        resultado: 'erro',
        mensagem: 'Produto não encontrado no cadastro.',
        codigo_barras
      });
    }

    // Verificar se produto pertence ao envio
    const { data: item, error: itemErr } = await supabase
      .from('itens_envio')
      .select('*')
      .eq('envio_id', envio_id)
      .eq('produto_id', produto.id)
      .single();

    if (itemErr || !item) {
      await supabase.from('log_bipagem').insert([{
        envio_id,
        produto_id: produto.id,
        codigo_barras,
        resultado: 'erro'
      }]);
      return res.json({
        ok: false,
        resultado: 'erro',
        mensagem: `"${produto.descricao}" não pertence a este pedido.`,
        produto
      });
    }

    // Verificar quantidade
    if (item.quantidade_conferida >= item.quantidade) {
      await supabase.from('log_bipagem').insert([{
        envio_id,
        produto_id: produto.id,
        codigo_barras,
        resultado: 'excesso'
      }]);
      return res.json({
        ok: false,
        resultado: 'excesso',
        mensagem: `Quantidade excedida para "${produto.descricao}". Esperado: ${item.quantidade}, já bipado: ${item.quantidade_conferida}.`,
        produto,
        item
      });
    }

    // Incrementar quantidade conferida
    const novaQtd = item.quantidade_conferida + 1;
    const { error: updErr } = await supabase
      .from('itens_envio')
      .update({ quantidade_conferida: novaQtd })
      .eq('id', item.id);
    if (updErr) throw updErr;

    // Log positivo
    await supabase.from('log_bipagem').insert([{
      envio_id,
      produto_id: produto.id,
      codigo_barras,
      resultado: 'ok'
    }]);

    // Verificar se todos os itens foram conferidos
    const { data: todosItens } = await supabase
      .from('itens_envio')
      .select('quantidade, quantidade_conferida')
      .eq('envio_id', envio_id);

    const concluido = todosItens.every(i =>
      (i.quantidade_conferida + (item.id === item.id ? 0 : 0)) >= i.quantidade
      // Recalcular com valor atualizado
    );

    // Checar novamente com dado fresco
    const { data: itensAtuais } = await supabase
      .from('itens_envio')
      .select('quantidade, quantidade_conferida')
      .eq('envio_id', envio_id);

    const todosConcluidos = itensAtuais.every(i => i.quantidade_conferida >= i.quantidade);

    if (todosConcluidos) {
      await supabase.from('envios').update({
        status: 'concluido',
        concluido_em: new Date().toISOString()
      }).eq('id', envio_id);
    } else {
      // Marcar como em conferência se ainda não estava
      await supabase.from('envios').update({ status: 'em_conferencia', iniciado_em: new Date().toISOString() })
        .eq('id', envio_id).eq('status', 'pendente');
    }

    const restante = item.quantidade - novaQtd;
    return res.json({
      ok: true,
      resultado: 'ok',
      mensagem: `✓ ${produto.descricao}`,
      produto,
      item: { ...item, quantidade_conferida: novaQtd },
      restante,
      concluido: todosConcluidos
    });

  } catch (err) {
    console.error('[bipar]', err);
    return res.status(500).json({ error: err.message || 'Erro interno.' });
  }
}
