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
      max_tokens: 512,
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
              text: `Analise esta etiqueta de envio/entrega e extraia as informações.

Retorne APENAS JSON válido, sem markdown:
{
  "nome_cliente": "nome completo do destinatário",
  "nota_fiscal": "número da NF ou null",
  "endereco": "endereço se visível ou null"
}

Retorne apenas o JSON, sem texto adicional.`
            }
          ]
        }
      ]
    });

    const rawText = response.choices[0].message.content.trim();
    let dadosEtiqueta;
    try {
      dadosEtiqueta = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('IA não retornou JSON válido.');
      dadosEtiqueta = JSON.parse(match[0]);
    }

    const { nome_cliente, nota_fiscal } = dadosEtiqueta;
    if (!nome_cliente && !nota_fiscal) {
      return res.status(422).json({ error: 'Não foi possível identificar cliente ou NF na etiqueta.' });
    }

    let envioEncontrado = null;

    if (nota_fiscal) {
      const { data } = await supabase
        .from('envios')
        .select(`*, itens_envio(*, produtos(*))`)
        .eq('nota_fiscal', nota_fiscal)
        .neq('status', 'concluido')
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) envioEncontrado = data[0];
    }

    if (!envioEncontrado && nome_cliente) {
      const nomeLimpo = nome_cliente.toLowerCase().trim();
      const { data } = await supabase
        .from('envios')
        .select(`*, itens_envio(*, produtos(*))`)
        .ilike('nome_cliente', `%${nomeLimpo.split(' ')[0]}%`)
        .neq('status', 'concluido')
        .order('created_at', { ascending: false })
        .limit(5);

      if (data && data.length > 0) {
        envioEncontrado = data.find(e =>
          e.nome_cliente.toLowerCase().includes(nomeLimpo.split(' ')[0])
        ) || data[0];
      }
    }

    return res.json({
      dadosEtiqueta,
      envio: envioEncontrado || null,
      encontrado: !!envioEncontrado
    });

  } catch (err) {
    console.error('[etiqueta]', err);
    return res.status(500).json({ error: err.message || 'Erro ao processar etiqueta.' });
  }
}
