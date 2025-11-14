import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';

let scene, camera, renderer, effectSBS, controls, mixer;
let clock = new THREE.Clock();
let currentEscenario = null;
let currentPersonaje = null;
let isPaused = false;

const stage = document.getElementById('stage');
const loaderOverlay = document.getElementById('loader');
const chkSBS = document.getElementById('chkSBS');

init();
animate();

function init() {
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.shadowMap.enabled = true;
  stage.appendChild(renderer.domElement);

  // WebXR
  renderer.xr.enabled = true;
  const vrBtn = VRButton.createButton(renderer);
  document.body.appendChild(vrBtn);

  // Side-by-Side para Cardboard
  effectSBS = new StereoEffect(renderer);
  effectSBS.setSize(stage.clientWidth, stage.clientHeight);

  // Escena y cámara
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0f17);

  camera = new THREE.PerspectiveCamera(70, stage.clientWidth / stage.clientHeight, 0.1, 1000);
  camera.position.set(0, 1.6, 4);

  // Controles
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);

  // Luces
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 5);
  dir.castShadow = true;
  scene.add(dir);

  // Piso
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 64),
    new THREE.MeshStandardMaterial({ color: 0x222733, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // UI
  document.getElementById('btnCentrar').onclick = () => {
    controls.target.set(0, 1, 0);
    camera.position.set(0, 1.6, 4);
  };
  document.getElementById('btnPlayPause').onclick = () => {
    isPaused = !isPaused;
    document.getElementById('btnPlayPause').textContent = isPaused ? 'Reanudar animación' : 'Pausar animación';
  };
  document.getElementById('btnCargarEscenario').onclick = () => {
    const url = document.getElementById('inputEscenario').value.trim();
    cargarEscenario(url);
  };
  document.getElementById('btnCargarPersonaje').onclick = () => {
    const url = document.getElementById('inputPersonaje').value.trim();
    cargarPersonaje(url);
  };
  document.getElementById('btnCargarAnimacion').onclick = () => {
    const url = document.getElementById('inputAnimacion').value.trim();
    if (url) cargarAnimacionFBX(url);
  };

  chkSBS.addEventListener('change', onResize);
  window.addEventListener('resize', onResize);

  // Defaults
  cargarEscenario('./practica1.glb');   // también puede ser .fbx
  cargarPersonaje('./models/Ch44_nonPBR.fbx');   // personaje Mixamo en FBX
}

function setLoading(v) { loaderOverlay.classList.toggle('d-none', !v); }

function clearObject(obj) {
  if (!obj) return;
  scene.remove(obj);
  obj.traverse?.((c) => {
    if (c.isMesh) {
      c.geometry?.dispose?.();
      if (Array.isArray(c.material)) c.material.forEach(m => m.dispose?.());
      else c.material?.dispose?.();
    }
  });
}

function getExt(url) {
  const q = url.split('?')[0];
  return q.slice(q.lastIndexOf('.') + 1).toLowerCase();
}

function cargarEscenario(url) {
  if (!url) return;
  setLoading(true);
  const ext = getExt(url);
  const useFBX = ext === 'fbx';
  const loader = useFBX ? new FBXLoader() : new GLTFLoader();

  loader.load(url, (res) => {
    clearObject(currentEscenario);
    currentEscenario = useFBX ? res : res.scene;
    currentEscenario.traverse((c) => { c.castShadow = true; c.receiveShadow = true; });

    // FBX suele venir en centímetros -> escala a metros aprox
    if (useFBX) currentEscenario.scale.setScalar(0.01);

    currentEscenario.position.set(0, 0, 0);
    scene.add(currentEscenario);
    fitSceneToCamera(currentEscenario);
    setLoading(false);
  }, undefined, (err) => {
    console.error('Error cargando escenario:', err);
    setLoading(false);
  });
}

function cargarPersonaje(url) {
  if (!url) return;
  setLoading(true);
  const ext = getExt(url);
  const useFBX = ext === 'fbx';
  const loader = useFBX ? new FBXLoader() : new GLTFLoader();

  loader.load(url, (res) => {
    clearObject(currentPersonaje);
    currentPersonaje = useFBX ? res : res.scene;
    currentPersonaje.traverse((c) => { c.castShadow = true; });

    // FBX Mixamo → escala típica 0.01
    if (useFBX) currentPersonaje.scale.setScalar(0.01);

    currentPersonaje.position.set(0, 0, 0);
    scene.add(currentPersonaje);

    // Animación embebida (FBX con clip) o GLB con clips
    const clips = useFBX ? (res.animations || []) : (res.animations || []);
    if (clips.length) {
      mixer?.stopAllAction?.();
      mixer = new THREE.AnimationMixer(currentPersonaje);
      const action = mixer.clipAction(clips[0]);
      action.reset().play();
    }
    setLoading(false);
  }, undefined, (err) => {
    console.error('Error cargando personaje:', err);
    setLoading(false);
  });
}

/**
 * Carga una animación FBX y la aplica al personaje actual.
 * Requiere que el rig/bones coincidan (p. ej., ambos de Mixamo).
 * Exporta en Mixamo como FBX "Without Skin" para clips sueltos.
 */
function cargarAnimacionFBX(url) {
  if (!currentPersonaje) {
    console.warn('Primero carga un personaje para aplicar la animación.');
    return;
  }
  setLoading(true);
  const loader = new FBXLoader();
  loader.load(url, (animObj) => {
    const clips = animObj.animations || [];
    if (!clips.length) {
      console.warn('La animación FBX no contiene AnimationClips.');
      setLoading(false);
      return;
    }
    if (!mixer) mixer = new THREE.AnimationMixer(currentPersonaje);
    mixer.stopAllAction();
    const action = mixer.clipAction(clips[0]);
    action.reset().play();
    setLoading(false);
  }, undefined, (err) => {
    console.error('Error cargando animación FBX:', err);
    setLoading(false);
  });
}

function fitSceneToCamera(root) {
  // Calcular el bounding box del modelo
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Ajustar la cámara al centro del modelo
  controls.target.copy(center);

  // Calcular la distancia de la cámara para estar dentro del modelo
  const maxDim = Math.max(size.x, size.y, size.z);
  const fitDist = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

  // Colocar la cámara dentro de la estructura (ajustar la distancia a la que se sitúa dentro)
  camera.position.copy(center).add(new THREE.Vector3(0, 1.6, fitDist * 0.5)); // Coloca la cámara dentro de la estructura y ajusta el zoom

  // Asegúrate de que la cámara esté mirando hacia el centro
  controls.update(); // Esto asegura que los controles se actualicen correctamente
}

function onResize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  effectSBS.setSize(w, h);
}

function animate() {
  const dt = clock.getDelta();
  if (mixer && !isPaused) mixer.update(dt);
  controls.update();

  if (chkSBS.checked && !renderer.xr.isPresenting) {
    effectSBS.render(scene, camera);
  } else {
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(animate);
}
