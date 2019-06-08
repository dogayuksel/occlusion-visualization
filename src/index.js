import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import regl from 'regl';
import earcut from 'earcut';

function long2tile(l, zoom) {
  return ((l + 180) / 360) * Math.pow(2, zoom);
}

function lat2tile(l, zoom) {
  return (
    ((1 -
      Math.log(
        Math.tan((l * Math.PI) / 180) + 1 / Math.cos((l * Math.PI) / 180)
      ) /
      Math.PI) /
     2) *
      Math.pow(2, zoom)
  );
}

function loadImage(url) {
  console.log(`Downloading ${url}...`);
  return new Promise((accept, error) => {
    const img = new Image();
    img.onload = () => {
      accept(img);
    };
    img.onerror = error;
    img.crossOrigin = "anonymous";
    img.src = url;
  });
}

const zoom = 16;
const [lat, long] = [52.520815, 13.4094191];
const tLat = Math.floor(lat2tile(lat, zoom));
const tLong = Math.floor(long2tile(long, zoom));

const MAPBOX_STREETS = 'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8';
const MAPBOX_SATELLITE = 'https://api.mapbox.com/v4/mapbox.satellite';

const EXTEND = 4096;

const main = async () => {
  const vectorData = await fetch(
    `${MAPBOX_STREETS}/${zoom}/${tLong}/${tLat}.vector.pbf?access_token=${process.env.MAPBOX_KEY}`
  );
  const buffer = await vectorData.arrayBuffer();
  const tile = new VectorTile(new Protobuf(buffer));
  console.log('Number of Features: ', tile.layers.building.length);

  const buildings = [];
  const triangles = [];

  let minX = EXTEND;
  let maxX = -EXTEND;
  let minY = EXTEND;
  let maxY = -EXTEND;
  let maxHeight = 0;

  const TOWER_HEIGHT = 368;

  const polygonFromGeometry = (points) => points
        .slice(0, -1)
        .map(p => [p.x, p.y]);

  const earcutFromGeometry = (points) => points
        .slice(0, -1)
        .reduce((acc, val) => [...acc, val.x, val.y], []);

  for (let featureIndex = 0; featureIndex < tile.layers.building.length; featureIndex++) {
    const building = tile.layers.building.feature(featureIndex);
    const buildingHeight = building.properties.height;
    const polygons = building.loadGeometry();
    if (buildingHeight) {
      buildings.push(building);
      if (buildingHeight > maxHeight && buildingHeight != TOWER_HEIGHT) {
        maxHeight = buildingHeight;
      }
      for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
        const polygon = polygons[polygonIndex];
        for (let pointIndex = 0; pointIndex < polygon.length; pointIndex++) {
          const { x, y } = polygon[pointIndex];
          if (x > maxX) { maxX = x; }
          if (x < minX) { minX = x; }
          if (y > maxY) { maxY = y; }
          if (y < minY) { minY = y; }
        }
        // console.log(pointArrays[pointIndex]);
        // console.log(pointArrays);

        const triangleEdges = earcut(earcutFromGeometry(polygon));
        for (let triangleIndex = 0; triangleIndex < triangleEdges.length; triangleIndex++) {
          const edge = polygon[triangleEdges[triangleIndex]];
          triangles.push((edge.x / EXTEND - 0.5) * 2);
          triangles.push((edge.y / EXTEND - 0.5) * -2);
          triangles.push(buildingHeight / (TOWER_HEIGHT + 1));
        }
      }
    }
  }

  console.log("maxX", maxX);
  console.log('minX', minX);
  console.log('maxY', maxY);
  console.log('minY', minY);
  console.log('maxHeight', maxHeight);
  
  const satelliteImage = await loadImage(
    `${MAPBOX_SATELLITE}/${zoom}/${tLong}/${tLat}.pngraw?access_token=${process.env.MAPBOX_KEY}`
  );

  document.body.appendChild(satelliteImage);
  const canvas = document.createElement("canvas");
  canvas.width = satelliteImage.width;
  canvas.height = satelliteImage.height;
  document.body.appendChild(canvas);

  const reglInstance = regl({ canvas: canvas });
  const u_tSatellite = reglInstance.texture({
    data: satelliteImage,
    flipY: true,
  });

  const cmdProcessElevation = reglInstance({
    vert: `
      precision highp float;
      attribute vec3 position;

      void main() {
        gl_Position = vec4(position, 1);
      }
    `,
    frag: `
      precision highp float;

      uniform sampler2D u_tSatellite;
      uniform vec2 u_resolution;

      float plot(vec2 st, float pct){
        return smoothstep( pct-0.02, pct, st.y) -
               smoothstep( pct, pct+0.02, st.y);
      }

      void main() {
        vec2 st = gl_FragCoord.xy/u_resolution;
        float y = st.x;
        vec3 color = vec3(y);

        // Plot a line
        float pct = plot(st, y);
        vec4 newColor = vec4((1.0 - pct) * color + pct * vec3(0.0, 0.7, 0.0), 1.0);
        vec4 mixed = mix(newColor, texture2D(u_tSatellite, st), 0.7);
        gl_FragColor = mixed;
      }
    `,
    attributes: {
      position: triangles,
    },
    count: triangles.length / 9,
    uniforms: {
      u_tSatellite: u_tSatellite,
      u_resolution: [satelliteImage.width, satelliteImage.height]
    },
    viewport: { x: 0, y: 0, width: satelliteImage.width, height: satelliteImage.height },
  });

  cmdProcessElevation();
};

main();
