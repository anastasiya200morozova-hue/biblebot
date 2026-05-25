import { type Application, type Request, type Response } from 'express';
import { supabase } from '../lib/supabase';
import { config } from '../config';

// In-memory счётчик неудачных попыток для IP-бана
const failedAttempts = new Map<string, { count: number; bannedUntil: number }>();

function authMiddleware(req: Request, res: Response): boolean {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const attempts = failedAttempts.get(ip);

  if (attempts && attempts.bannedUntil > now) {
    res.sendStatus(403);
    return false;
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== config.admin.secret) {
    const current = failedAttempts.get(ip) ?? { count: 0, bannedUntil: 0 };
    current.count += 1;
    if (current.count >= 5) {
      current.bannedUntil = now + 60 * 60 * 1000; // бан на 1 час
    }
    failedAttempts.set(ip, current);
    res.sendStatus(401);
    return false;
  }

  // Сбрасываем счётчик при успешной авторизации
  failedAttempts.delete(ip);
  return true;
}

export function registerAdminRoutes(app: Application): void {
  app.get('/admin/stats', async (req, res) => {
    if (!authMiddleware(req, res)) return;

    const today = new Date().toISOString().split('T')[0];

    const [usersTotal, usersActive, msgsToday, crisisUnreviewed, costToday, costMonth] =
      await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true)
          .gte('updated_at', `${today}T00:00:00Z`),
        supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', `${today}T00:00:00Z`),
        supabase
          .from('crisis_logs')
          .select('*', { count: 'exact', head: true })
          .eq('reviewed_by_admin', false),
        supabase
          .from('agent_logs')
          .select('cost_usd')
          .gte('created_at', `${today}T00:00:00Z`),
        supabase
          .from('agent_logs')
          .select('cost_usd')
          .gte('created_at', `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`),
      ]);

    const sumCost = (rows: { cost_usd: number }[] | null) =>
      (rows ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);

    res.json({
      users_total: usersTotal.count ?? 0,
      users_active_today: usersActive.count ?? 0,
      messages_today: msgsToday.count ?? 0,
      crisis_unreviewed: crisisUnreviewed.count ?? 0,
      api_cost_today_usd: Math.round(sumCost(costToday.data) * 100) / 100,
      api_cost_month_usd: Math.round(sumCost(costMonth.data) * 100) / 100,
    });
  });

  app.get('/admin/crisis', async (req, res) => {
    if (!authMiddleware(req, res)) return;

    const { data } = await supabase
      .from('crisis_logs')
      .select('id, user_id, trigger_keywords, created_at, reviewed_by_admin, users(telegram_id)')
      .eq('reviewed_by_admin', false)
      .order('created_at', { ascending: false })
      .limit(50);

    res.json({ data: data ?? [] });
  });

  app.patch('/admin/crisis/:id/review', async (req, res) => {
    if (!authMiddleware(req, res)) return;

    const { id } = req.params;
    await supabase
      .from('crisis_logs')
      .update({ reviewed_by_admin: true, reviewed_at: new Date().toISOString() })
      .eq('id', id);

    res.json({ ok: true });
  });
}
