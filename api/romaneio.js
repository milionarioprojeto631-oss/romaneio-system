import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const { imageBase64, mediaType = 'image/jpeg' } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Imagem obrigatória.' });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mediaType};base64,${imageBase64}`,
                detail: 'high'
              }
            },
            {
              type: 'text',
              text: `Analise este romaneio/documento logístico e extraia TODOS os envios presentes.

Retorne APENAS um JSON válido, sem markdown, sem explicações, no seguinte formato:
{
  "envios": [
    {
      "nome_cliente": "Nome completo do cliente",
      "nota_fiscal": "Número da NF ou null",
      "itens": [
        {
          "descricao": "Descrição do produto",
          "quantidade": 1,
          "codigo_barras": "código se visível ou null",
          "codigo_interno": "código interno se visível ou null"
        }
      ]
    }
  ]
}

Regras:
- Identifique TODOS os clientes/pedidos separadamente
- quantidade deve ser número inteiro
- Se não encontrar NF, use null
- Se não encontrar código de barras, use null
- Retorne apenas o JSON, sem texto adicional`
            }
          ]
        }
      ]
    });

    const rawText = response.choices[0].message.content.trim();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('IA não retornou JSON válido.');
      parsed = JSON.parse(match[0]);
    }

    const { envios: enviosExtraidos } = parsed;
    if (!Array.isArray(enviosExtraidos) || enviosExtraidos.length === 0) {
      return res.status(422).json({ error: 'Nenhum envio identificado no romaneio.' });
    }

    const { data: produtos } = await supabase.from('produtos').select('*');
    const produtosMap = {};
    (produtos || []).forEach(p => {
      produtosMap[p.codigo_barras] = p;
      if (p.codigo_interno) produtosMap[`INT:${p.codigo_interno}`] = p;
    });

    const enviosSalvos = [];
    for (const envio of enviosExtraidos) {
      const { data: envioData, error: envioErr } = await supabase
        .from('envios')
        .insert([{
          nome_cliente: envio.nome_cliente || 'Cliente não identificado',
          nota_fiscal: envio.nota_fiscal || null,
          data_envio: new Date().toISOString().split('T')[0],
          status: 'pendente'
        }])
        .select()
        .single();
      if (envioErr) throw envioErr;

      const itens = [];
      for (const item of (envio.itens || [])) {
        let produto_id = null;
        if (item.codigo_barras && produtosMap[item.codigo_barras]) {
          produto_id = produtosMap[item.codigo_barras].id;
        } else if (item.codigo_interno && produtosMap[`INT:${item.codigo_interno}`]) {
          produto_id = produtosMap[`INT:${item.codigo_interno}`].id;
        } else if (item.descricao && produtos) {
          const desc = item.descricao.toLowerCase();
          const found = produtos.find(p => p.descricao.toLowerCase().includes(desc.substring(0, 15)));
          if (found) produto_id = found.id;
        }
        itens.push({
          envio_id: envioData.id,
          produto_id,
          descricao_manual: item.descricao,
          quantidade: parseInt(item.quantidade) || 1,
          quantidade_conferida: 0
        });
      }

      if (itens.length > 0) {
        const { error: itensErr } = await supabase.from('itens_envio').insert(itens);
        if (itensErr) throw itensErr;
      }

      enviosSalvos.push({ ...envioData, itens_count: itens.length });
    }

    return res.status(201).json({ ok: true, total: enviosSalvos.length, envios: enviosSalvos });

  } catch (err) {
    console.error('[romaneio]', err);
    return res.status(500).json({ error: err.message || 'Erro ao processar romaneio.' });
  }
}
