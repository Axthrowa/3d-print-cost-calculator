import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface StlViewerProps {
  positions: Float32Array;
  /** Koyu tema açıkken farklı zemin/ızgara rengi kullanılır. */
  dark: boolean;
}

/**
 * Yüklenen STL modelini gösteren küçük 3D görüntüleyici.
 * Fare ile döndürülür, tekerlekle yakınlaştırılır; kullanıcı dokunana kadar
 * yavaşça kendi kendine döner.
 */
export default function StlViewer({ positions, dark }: StlViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || positions.length === 0) return;

    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.1, 5000);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // WebGL kapalıysa görüntüleyiciyi sessizce atla.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    // --- Geometri ---
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    const box = geometry.boundingBox ?? new Box3();
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // Modeli merkeze al ve tabanını sıfıra oturt.
    geometry.translate(-center.x, -center.y, -box.min.z);

    const material = new MeshStandardMaterial({
      color: new Color(dark ? 0x38bdf8 : 0x0ea5e9),
      metalness: 0.15,
      roughness: 0.55,
      flatShading: false,
    });

    const mesh = new Mesh(geometry, material);
    // STL'de Z yukarıdır; sahnede Y yukarı olacak şekilde çevir.
    mesh.rotation.x = -Math.PI / 2;

    const group = new Group();
    group.add(mesh);
    scene.add(group);

    const grid = new GridHelper(
      maxDim * 3,
      12,
      dark ? 0x334155 : 0xcbd5e1,
      dark ? 0x1e293b : 0xe2e8f0,
    );
    grid.position.y = 0;
    scene.add(grid);

    scene.add(new AmbientLight(0xffffff, dark ? 1.1 : 1.4));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 2, 1.5).multiplyScalar(maxDim);
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.8);
    fill.position.set(-1.5, 0.5, -1).multiplyScalar(maxDim);
    scene.add(fill);

    camera.position.set(maxDim * 1.1, maxDim * 0.95, maxDim * 1.4);
    camera.lookAt(0, size.z / 2, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, size.z / 2, 0);
    controls.minDistance = maxDim * 0.5;
    controls.maxDistance = maxDim * 6;
    controls.update();

    let autoRotate = true;
    const stopAuto = () => {
      autoRotate = false;
    };
    controls.addEventListener('start', stopAuto);

    // --- Boyut takibi ---
    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // --- Çizim döngüsü ---
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (autoRotate) group.rotation.y += 0.004;
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener('start', stopAuto);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      grid.geometry.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [positions, dark]);

  return (
    <div
      ref={hostRef}
      className="h-56 w-full cursor-grab overflow-hidden rounded-xl border border-slate-200 bg-slate-50 active:cursor-grabbing dark:border-white/10 dark:bg-white/[0.03]"
      aria-label="3B model önizlemesi"
    />
  );
}
