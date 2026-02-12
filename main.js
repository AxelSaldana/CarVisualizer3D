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

    // Increase far plane to ensure we see everything
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true; // Enable WebXR
    container.appendChild(renderer.domElement);

    // AR Button with DOM Overlay (for touch gestures)
    // ARButton automatically hides on desktop (no WebXR support)
    document.body.appendChild(ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body }
    }));



    // Dark night environment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    // Dark background for night aesthetic
    scene.background = new THREE.Color(0x0a0a0a); // Very dark background

    // Use RoomEnvironment for subtle lighting
    const environment = new RoomEnvironment();
    scene.environment = pmremGenerator.fromScene(environment, 0.02).texture; // Lower intensity for night

    // Add some ambient light for visibility
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    // Add a subtle directional light (moonlight effect)
    const moonLight = new THREE.DirectionalLight(0xb0c4de, 0.5);
    moonLight.position.set(5, 10, 5);
    scene.add(moonLight);

    // Controls (for non-AR mode)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', render); // use if there is no animation loop
    controls.minDistance = 0.1; // Allow closer zoom
    controls.maxDistance = 1000; // Allow farther zoom
    controls.target.set(0, 0, 0); // Default target
    controls.update();

    window.controls = controls; // Expose for loader to update target

    // Load Model (GLTF) with LoadingManager for textures
    const manager = new THREE.LoadingManager();

    // Loading progress
    const loadingScreen = document.getElementById('loadingScreen');
    const loadingProgress = document.getElementById('loadingProgress');
    const loadingPercent = document.getElementById('loadingPercent');

    manager.onProgress = function (url, loaded, total) {
        const progress = (loaded / total) * 100;
        loadingProgress.style.width = progress + '%';
        loadingPercent.textContent = Math.round(progress);
    };

    manager.onLoad = function () {
        console.log('Loading complete!');
        // Hide loading screen with fade out
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
        }, 500);
    };

    const loader = new GLTFLoader(manager);
    loader.load('/Modelo/scene-optimized.glb', function (gltf) {
        carModel = gltf.scene;

        // GLTF models scale
        carModel.scale.setScalar(10);

        // Clean up model: Remove Text and loose geometry that might be clutter
        const toRemove = [];
        console.log("Starting model cleanup...");

        carModel.traverse((child) => {
            // Remove Text nodes (Found Text.023 - Text.039 in inspection)
            if (child.name.match(/Text/i)) {
                toRemove.push(child);
                return;
            }

            // Remove specific known artifacts or shadows if they look bad
            if (child.name.includes('ground_shadow') || child.name.includes('Plane')) {
                // Be careful with Planes, some cars use planes for mirrors or windows.
                // But typically "Plane.XXX" in a messy export are reference images.
                // Let's hide them if they are far from center? 
                // Or just hide them if they are not standard car parts.
                // safe bet: hide 'ground_shadow'
                if (child.name.includes('ground_shadow')) {
                    toRemove.push(child);
                    return;
                }
            }

            // Heuristic: Remove objects that are "floating" too high
            if (child.position.y > 50 || child.position.y < -50) {
                toRemove.push(child);
                return;
            }

            // Enable shadows
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        console.log("Removing " + toRemove.length + " objects.");
        toRemove.forEach(child => {
            if (child.parent) child.parent.remove(child);
        });

        scene.add(carModel);

        // Auto-center and fit camera
        const box = new THREE.Box3().setFromObject(carModel);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        console.log("Model Size:", size);
        console.log("Model Center:", center);

        // If size is too huge (artifacts expanding box), we might need to recalculate
        // considering only the "dense" part of the model.
        // But the previous cleanup should help.
        if (size.lengthSq() === 0) {
            console.error("Model appears to be empty!");
        } else {
            // Fit camera to object (Make it close and personal!)
            const maxDim = Math.max(size.x, size.y, size.z);

            // Position camera closer for better view (especially on mobile)
            const distance = maxDim * 0.8; // Closer distance

            camera.position.set(
                center.x + distance * 0.7, // Offset X
                center.y + size.y * 0.5,   // Offset Y (slightly up)
                center.z + distance * 0.7  // Offset Z
            );

            camera.lookAt(center);

            // Update controls target
            if (window.controls) {
                window.controls.target.copy(center);
                window.controls.update();
            }
        }

        // Add lights - Enhanced for better material visibility
        // Add ambient light for general brightness
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        // Main directional light
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(5, 10, 7);
        dirLight.castShadow = true;
        scene.add(dirLight);

        // Fill light from opposite side
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
        fillLight.position.set(-5, 5, -5);
        scene.add(fillLight);

        render();
    },
        // Progress callback
        function (xhr) {
            console.log((xhr.loaded / xhr.total * 100) + '% loaded');
        },
        // Error callback
        function (error) {
            console.error('An error happened loading the FBX:', error);
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

    // Touch Events: Scaling (2 fingers) and Rotation (1 finger)
    let initialDistance = 0;
    let initialScale = new THREE.Vector3();
    let previousTouchX = 0;

    window.addEventListener('touchstart', (e) => {
        // Pinch (2 fingers)
        if (e.touches.length === 2 && carModel) {
            const dx = e.touches[0].pageX - e.touches[1].pageX;
            const dy = e.touches[0].pageY - e.touches[1].pageY;
            initialDistance = Math.sqrt(dx * dx + dy * dy);
            initialScale.copy(carModel.scale);
        }
        // Rotate (1 finger)
        if (e.touches.length === 1 && carModel) {
            previousTouchX = e.touches[0].pageX;
        }
    });

    window.addEventListener('touchmove', (e) => {
        // Pinch (2 fingers)
        if (e.touches.length === 2 && carModel && initialDistance > 0) {
            const dx = e.touches[0].pageX - e.touches[1].pageX;
            const dy = e.touches[0].pageY - e.touches[1].pageY;
            const currentDistance = Math.sqrt(dx * dx + dy * dy);

            const scaleFactor = currentDistance / initialDistance;
            const newScale = initialScale.clone().multiplyScalar(scaleFactor);
            carModel.scale.copy(newScale);
        }

        // Rotate (1 finger)
        if (e.touches.length === 1 && carModel) {
            const deltaX = e.touches[0].pageX - previousTouchX;
            previousTouchX = e.touches[0].pageX;
            // Rotation speed factor
            carModel.rotation.y += deltaX * 0.005;
        }
    });

    // Setup UI Controls
    setupUIControls();
}

function setupUIControls() {
    // Color picker
    const colorBtns = document.querySelectorAll('.color-btn');
    const colorNameEl = document.querySelector('.color-name');

    const colorNames = {
        '#2563eb': 'Signature Neon Blue',
        '#1e293b': 'Midnight Black',
        '#dc2626': 'Racing Red',
        '#f59e0b': 'Sunset Orange',
        '#ffffff': 'Pearl White'
    };

    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.color;

            // Update active state
            colorBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update color name
            colorNameEl.innerHTML = `${colorNames[color]} <span class="included">included</span>`;

            // Change car color
            if (carModel) {
                carModel.traverse((child) => {
                    if (child.isMesh && child.material) {
                        // Only change body materials, not glass/chrome
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                if (mat.color) mat.color.set(color);
                            });
                        } else {
                            if (child.material.color) {
                                child.material.color.set(color);
                            }
                        }
                    }
                });
            }
        });
    });

    // Rotation buttons
    const rotateLeft = document.getElementById('rotateLeft');
    const rotateRight = document.getElementById('rotateRight');

    if (rotateLeft) {
        rotateLeft.addEventListener('click', () => {
            if (carModel) {
                carModel.rotation.y += 0.3;
            }
        });
    }

    if (rotateRight) {
        rotateRight.addEventListener('click', () => {
            if (carModel) {
                carModel.rotation.y -= 0.3;
            }
        });
    }

    // Custom AR button (triggers the hidden ARButton)
    const arButtonCustom = document.getElementById('arButtonCustom');
    if (arButtonCustom) {
        arButtonCustom.addEventListener('click', () => {
            const arButton = document.querySelector('button[class*="ARButton"]');
            if (arButton) {
                arButton.click();
            }
        });
    }

    // Mobile toggle button for description panel
    const mobileToggle = document.getElementById('mobileToggle');
    const panelContent = document.getElementById('panelContent');
    if (mobileToggle && panelContent) {
        mobileToggle.addEventListener('click', () => {
            panelContent.classList.toggle('active');
        });
    }
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
