// Serves the yearbook PDF from the same origin as the site.
// GitHub release assets don't send CORS headers, so the browser can't fetch
// them directly. This proxy fetches the file server-side (following GitHub's
// redirect) and forwards Range requests so pdf.js can load it in chunks.
const PDF_SOURCE =
  'https://github.com/cubicolor/anuario-interactivo/releases/download/v1.0.0/anuario.pdf';

const PASSTHROUGH_HEADERS = [
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified'
];

export default async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const upstreamHeaders = new Headers();
  const range = req.headers.get('range');
  if (range) upstreamHeaders.set('range', range);

  const upstream = await fetch(PDF_SOURCE, {
    method: req.method,
    headers: upstreamHeaders,
    redirect: 'follow'
  });

  if (!upstream.ok) {
    return new Response('No se pudo obtener el PDF.', {
      status: upstream.status === 404 ? 404 : 502
    });
  }

  const headers = new Headers({
    'content-type': 'application/pdf',
    'cache-control': 'public, max-age=3600'
  });
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');

  return new Response(req.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers
  });
};

export const config = {
  path: '/anuario.pdf'
};
