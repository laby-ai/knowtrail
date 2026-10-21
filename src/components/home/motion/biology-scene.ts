import * as THREE from 'three';

/** Sculpted membrane, solid nucleus and molecular DNA. No wireframe geometry. */
export function createBiologyScene() {
  const scene = new THREE.Scene();
  const cell = new THREE.Group(); cell.position.set(-.28, .48, 0); scene.add(cell);
  const membrane = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, tint: { value: new THREE.Color('#73b6ff') } },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    vertexShader: `
      uniform float time; varying vec3 normalView; varying vec3 positionView; varying vec3 localPosition;
      void main() {
        float ripple = sin(position.x*7.0+time*.4)*sin(position.y*6.0-time*.3)*sin(position.z*7.0+time*.2);
        vec3 p = position + normal * ripple * .045;
        localPosition=p; normalView=normalize(normalMatrix*normal);
        vec4 viewPosition=modelViewMatrix*vec4(p,1.0); positionView=viewPosition.xyz;
        gl_Position=projectionMatrix*viewPosition;
      }`,
    fragmentShader: `
      uniform vec3 tint; uniform float time; varying vec3 normalView; varying vec3 positionView; varying vec3 localPosition;
      void main() {
        float facing=abs(dot(normalize(normalView),normalize(-positionView)));
        float rim=pow(1.0-facing,2.4);
        float grain=sin(localPosition.x*34.0+sin(localPosition.z*23.0))*sin(localPosition.y*31.0+time*.25);
        float highlights=pow(max(0.0,dot(normalize(normalView),normalize(vec3(-.6,.8,1.0)))),12.0);
        float alpha=.045+rim*.64+highlights*.18+grain*.025;
        gl_FragColor=vec4(tint*(.65+rim*.7)+vec3(highlights*.25),alpha);
      }`,
  });
  cell.add(new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 48), membrane));
  const nucleusMaterial = new THREE.MeshPhysicalMaterial({ color: '#b5a4f5', emissive: '#5949b7', emissiveIntensity: .45, roughness: .32, metalness: .18, clearcoat: 1 });
  const nucleus = new THREE.Mesh(new THREE.SphereGeometry(.37, 40, 32), nucleusMaterial);
  nucleus.position.set(-.12, -.06, .12); cell.add(nucleus);
  const beadGeometry = new THREE.SphereGeometry(.055, 12, 10);
  const blue = new THREE.MeshStandardMaterial({ color: '#8edaff', emissive: '#376cac', emissiveIntensity: .35, roughness: .28, metalness: .25 });
  const violet = new THREE.MeshStandardMaterial({ color: '#b7a5f8', emissive: '#6650a8', emissiveIntensity: .3, roughness: .3, metalness: .25 });
  for (let index = 0; index < 46; index++) {
    const y = 1 - (index + .5) / 46 * 2;
    const radius = Math.sqrt(1 - y * y) * .91;
    const angle = index * 2.39996;
    const bead = new THREE.Mesh(beadGeometry, index % 3 ? blue : violet);
    bead.position.set(Math.cos(angle) * radius, y * .91, Math.sin(angle) * radius);
    bead.scale.setScalar(index % 5 === 0 ? 1.7 : .7); cell.add(bead);
  }
  const dna = new THREE.Group(); dna.position.set(.55, -1.15, .3); dna.rotation.z = -.65; scene.add(dna);
  const strandPoints = (offset: number) => Array.from({ length: 101 }, (_, index) => {
    const t = index / 100;
    return new THREE.Vector3(Math.cos(t * Math.PI * 5 + offset) * .32, (t - .5) * 2.7, Math.sin(t * Math.PI * 5 + offset) * .32);
  });
  for (const [offset, material] of [[0, blue], [Math.PI, violet]] as const) {
    dna.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(strandPoints(offset)), 100, .035, 8, false), material));
  }
  const rungGeometry = new THREE.CylinderGeometry(.018, .018, 1, 6);
  const axis = new THREE.Vector3(0, 1, 0);
  for (let index = 0; index < 23; index++) {
    const t = index / 22;
    const angle = t * Math.PI * 5;
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const rung = new THREE.Mesh(rungGeometry, index % 2 ? blue : violet);
    rung.position.y = (t - .5) * 2.7; rung.scale.y = .64;
    rung.quaternion.setFromUnitVectors(axis, direction); dna.add(rung);
  }
  scene.add(new THREE.AmbientLight('#b8cbff', 2));
  const key = new THREE.PointLight('#c4e8ff', 20, 12); key.position.set(-2, 3, 4); scene.add(key);
  const fill = new THREE.PointLight('#ae8dff', 10, 10); fill.position.set(3, -1, 2); scene.add(fill);
  return {
    scene,
    update(time: number, light: boolean) {
      membrane.uniforms.time.value = time;
      membrane.uniforms.tint.value.set(light ? '#637fce' : '#73b6ff');
      cell.rotation.y = time * .09; cell.rotation.z = Math.sin(time * .15) * .05;
      dna.rotation.y = time * .15;
      nucleus.scale.setScalar(1 + Math.sin(time * .6) * .025);
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) { geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); }
      });
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); scene.clear();
    },
  };
}
