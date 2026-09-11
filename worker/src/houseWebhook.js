// Webhook yang dipanggil Supabase Database Webhooks tiap ada baris di
// tabel `houses` yang ter-update (owner_citizen_id keisi) — port dari
// endpoint Express `/webhooks/house-rented` di bot/index.js versi Railway,
// jadi 1 fungsi biasa yang dipanggil dari router di src/index.js.

import { Api } from 'grammy'
import { createClient } from '@supabase/supabase-js'

export async function handleHouseRentedWebhook(request, env) {
  const secret = request.headers.get('x-webhook-secret')
  if (secret !== env.WEBHOOK_SECRET) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const api = new Api(env.BOT_TOKEN)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid json body' }, 400)
  }

  try {
    const record = body?.record
    const oldRecord = body?.old_record

    const justRented = oldRecord?.owner_citizen_id == null && record?.owner_citizen_id != null
    const alreadyHasTopic = Boolean(record?.telegram_topic_id)

    if (!justRented || alreadyHasTopic) {
      return jsonResponse({ skipped: true })
    }

    const { data: owner, error: ownerError } = await supabaseAdmin
      .from('citizens')
      .select('display_name, username')
      .eq('id', record.owner_citizen_id)
      .single()

    if (ownerError) throw ownerError

    const ownerName = owner.display_name || owner.username || 'Warga'
    const topicTitle = `🏡 Petak ${record.plot_number} — ${ownerName}`

    const topic = await api.createForumTopic(env.HOUSING_GROUP_CHAT_ID, topicTitle)

    let topicUrl
    const groupUsername = env.HOUSING_GROUP_USERNAME
    if (groupUsername) {
      topicUrl = `https://t.me/${groupUsername}/${topic.message_thread_id}`
    } else {
      const numericId = String(env.HOUSING_GROUP_CHAT_ID).replace('-100', '')
      topicUrl = `https://t.me/c/${numericId}/${topic.message_thread_id}`
    }

    const { error: updateError } = await supabaseAdmin
      .from('houses')
      .update({ telegram_topic_id: topic.message_thread_id, telegram_topic_url: topicUrl })
      .eq('id', record.id)

    if (updateError) throw updateError

    return jsonResponse({ success: true, topicUrl })
  } catch (err) {
    console.error('Gagal membuat forum topic:', err)
    return jsonResponse({ error: err.message }, 500)
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
