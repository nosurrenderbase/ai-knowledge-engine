import type {MetadataRoute} from 'next';

/** Home-screen install (Android, desktop Chrome): name, colours and the Efsane Başkan shield. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Efsane Başkan · Knowledge Engine',
    short_name: 'EB Panel',
    start_url: '/',
    display: 'standalone',
    background_color: '#eef0f4',
    theme_color: '#eef0f4',
    icons: [
      {src: '/icon-192.png', sizes: '192x192', type: 'image/png'},
      {src: '/icon-512.png', sizes: '512x512', type: 'image/png'},
      {src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
    ],
  };
}
