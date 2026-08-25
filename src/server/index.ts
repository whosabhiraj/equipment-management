import { Hono } from 'hono';
import { Bindings, Variables } from './db/client';
import { getAuth } from './auth';
import { requireSameOrigin, requireSession } from './middleware';
import itemsRouter from './routes/items';
import bookingsRouter from './routes/bookings';
import usersRouter from './routes/users';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Log requests in development
app.use('*', async (c, next) => {
  console.log(`[${c.req.method}] ${c.req.path}`);
  await next();
});

// Origin check on every state-changing request, including Better Auth's own.
app.use('/api/*', requireSameOrigin);

// Better Auth Route Handler. Registered before `requireSession` and terminating,
// so the sign-in / callback / sign-out routes stay reachable while signed out.
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
  const auth = getAuth(c.env.DB, c.env);
  return await auth.handler(c.req.raw);
});

// Default-deny: everything else under /api needs a valid session.
app.use('/api/*', requireSession);

// Mount Domain Routes
app.route('/api/items', itemsRouter);
app.route('/api/bookings', bookingsRouter);
app.route('/api/users', usersRouter);

// Fetch current user session details
app.get('/api/me', (c) => {
  const user = c.get('user');
  return c.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      roomNo: user.roomNo,
      disabled: user.disabled,
    },
  });
});

// Any unmatched /api path is a 404, not the SPA shell.
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Serve Frontend Static Assets (Vite App)
app.all('*', async (c) => {
  // If ASSETS is bound (running in Wrangler / Cloudflare)
  if (c.env.ASSETS) {
    try {
      const response = await c.env.ASSETS.fetch(c.req.raw);

      // SPA support: if the asset is not found (e.g. client router URL like /manage),
      // we serve index.html. Wrangler does this by default if not_found_handling = "single-page-application".
      // But we can add a fallback check here just in case.
      if (response.status === 404) {
        const indexRequest = new Request(new URL('/index.html', c.req.url).toString(), {
          method: 'GET',
          headers: c.req.raw.headers,
        });
        return await c.env.ASSETS.fetch(indexRequest);
      }

      return response;
    } catch (e) {
      console.error('Static Asset Fetch Error:', e);
      return c.text('Error retrieving static assets', 500);
    }
  }

  return c.text('Static Assets binding (ASSETS) is missing. If you are developing locally, run Vite dev server at port 5173 instead.', 500);
});

export default app;
