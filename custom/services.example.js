/* Custom map services for Andrew's Earth. They appear in the Layers tab (Base and Overlay lists) under "Custom services".

   You can also add services inside the app: Layers tab > "Add a custom service". Those are saved in your browser only. This file is for
   services you want built into the app when you build it (they show with a lock and cannot be edited in the app).

   HOW
   1. Copy this file to  custom/services.js  (that file is git-ignored) and edit it.
   2. Opening index.html loads it directly. To bake it into the single file run:  python3 tools/build-single.py
   3. Put secrets in environment variables and write ${ENV_NAME} here: the build fills them in, so a key is never saved
      in a file you might share. (Opening index.html directly does NOT fill them in; type the key in custom/services.js
      instead, which is safe because that file is never committed.)

   WARNING: the built single file CONTAINS these addresses and any keys. Do not publish or share that file. Anyone who has it can read them.

   TYPES (Web Mercator only; services using another tile grid are not supported)
     xyz            tile address with {z} {x} {y}   e.g. https://tiles.example.com/ortho/{z}/{x}/{y}.png
     arcgis-tile    an ArcGIS MapServer that has pre-made tiles    url: .../MapServer
     wms            layers: 'name1,name2'   (optional: format, transparent, version)
     arcgis-export  an ArcGIS MapServer drawn on demand    layers: 38 (a layer id)
   FIELDS  id, name, group, icon ('fa-...'), url, apiKey, attribution, maxZoom, maxNativeZoom, subdomains,
           headers { Name: 'value' }  (xyz and arcgis-tile only; the server must allow CORS)
   {apiKey} inside url or a header value is replaced by the entry's apiKey.
   WMS and ArcGIS-export layers get opacity only (no transparent-colour tools). */
window.AE_CUSTOM_SERVICES = [
  /* Example: a tile service with a key in the address
  { id: 'my-ortho', name: 'My Ortho', group: 'My services', type: 'xyz',
    url: 'https://tiles.example.com/ortho/{z}/{x}/{y}.png?key={apiKey}', apiKey: '${MY_ORTHO_KEY}',
    attribution: '© Example Pty Ltd', maxZoom: 21, maxNativeZoom: 21 },
  */
  /* Example: a service that wants a header
  { id: 'my-secure', name: 'My Secure Tiles', type: 'xyz', url: 'https://secure.example.com/tiles/{z}/{x}/{y}',
    headers: { Authorization: 'Bearer {apiKey}' }, apiKey: '${MY_TOKEN}' },
  */
];
