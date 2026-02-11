import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

let camera, scene, renderer;
let controller;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let carModel = null;

init();
animate();

function init() {
    const container = document.createElement('div');
    document.getElementById('app').appendChild(container);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true; // Enable WebXR
    container.appendChild(renderer.domElement);

    // AR Button
    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] }));

    // Environment for realistic reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    // Controls (for non-AR mode)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', render); // use if there is no animation loop
    controls.minDistance = 2;
    controls.maxDistance = 10;
    controls.target.set(0, 0, -0.2);
    controls.update();

    // Load Model
    const loader = new GLTFLoader();
    loader.load('/Modelo/scene.gltf', function (gltf) {
        carModel = gltf.scene;

        // Clean up model: Remove Text and loose geometry that might be clutter
        const toRemove = [];
        carModel.traverse((child) => {
            if (child.name.includes('Text') || child.name.includes('Cube')) {
                // Inspecting the gltf, there were many 'Cube' and 'Text' nodes. 
                // If the user wants JUST the car, we might need to be careful.
                // Let's hide Text for sure.
            }
            if (child.name.includes('Text')) {
                toRemove.push(child);
            }
            // Enable shadows
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        toRemove.forEach(child => child.parent.remove(child));

        // Auto-center and scale
        const box = new THREE.Box3().setFromObject(carModel);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // Normalize scale to approx 4 meters (cars are bigger than 2m usually)
        const maxDim = Math.max(size.x, size.y, size.z);
        let scale = 4.0 / maxDim;

        // If the model is wierdly small/large, adjust.
        if (!isFinite(scale)) scale = 1.0;

        carModel.scale.setScalar(scale);

        // Center model
        carModel.position.x = -center.x * scale;
        carModel.position.y = -box.min.y * scale;
        carModel.position.z = -center.z * scale;

        scene.add(carModel);

        // Add lights to help visualize better
        const dirLight = new THREE.DirectionalLight(0xffffff, 2);
        dirLight.position.set(5, 10, 7);
        dirLight.castShadow = true;
        scene.add(dirLight);

        render();
    });

    // AR Reticle (Visual guide for placement)
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial()
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // AR Interaction
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    window.addEventListener('resize', onWindowResize);
}

function onSelect() {
    if (reticle.visible && carModel) {
        // If reticle is active, move car to reticle position
        // We clone the model to place multiple or just move the single one?
        // Let's just move the single one for now to keep it simple
        carModel.position.setFromMatrixPosition(reticle.matrix);
        carModel.quaternion.setFromRotationMatrix(reticle.matrix);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    render();
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then(function (referenceSpace) {
                session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
                    hitTestSource = source;
                });
            });
            session.addEventListener('end', function () {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });
            hitTestSourceRequested = true;
        }

        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                reticle.visible = true;
                reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
            } else {
                reticle.visible = false;
            }
        }
    }

    renderer.render(scene, camera);
}
