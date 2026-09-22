// Controller karakter third-person buat mode jalan-jalan.
// Murni JavaScript (tanpa three.js) -- ngobrol sama dunia lewat objek `world`
// dari buildWalkWorld() (walkWorld.js), jadi bisa disimulasikan di Node.

export const PLAYER = {
  radius: 0.35, // radius tubuh (meter) buat tabrakan tembok
  height: 1.75, // tinggi tubuh
  stepUp: 0.6, // pijakan yang masih "terjangkau" di atas kaki
  snapDown: 0.45, // turun lebih dari ini = dianggap jatuh, bukan nempel tanah
  walkSpeed: 4.2, // m/s
  runSpeed: 7.2,
  groundAccel: 14, // makin besar makin responsif
  airAccel: 3.5,
  gravity: 24,
  jumpSpeed: 7.4, // -> lompat setinggi ~1.1 m, di udara ~0.6 detik
  maxFall: 30,
  coyoteTime: 0.12, // masih boleh lompat sesaat setelah lepas tepi
  jumpBuffer: 0.12, // tombol lompat yang ditekan sesaat sebelum mendarat
  maxSlopeRise: 1.4, // tanjakan max (naik per meter jalan) ~ 54 derajat
  curbRise: 0.3, // tonjolan sekecil ini boleh dinaiki instan (trotoar)
}

export function createPlayer(x, y, z, yaw = 0) {
  return {
    x, y, z,
    vx: 0, vz: 0, vy: 0,
    grounded: true,
    coyote: PLAYER.coyoteTime,
    jumpBuf: 0,
    yaw, // arah hadap badan (radian, 0 = menghadap +Z)
    speed: 0, // laju horizontal aktual (m/s), buat animasi
    airTime: 0,
    justJumped: false, // true 1 frame pas lompat -> pemicu animasi 'Jump'
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

// Kecepatan target dari besar joystick (0..1): jalan pelan -> jalan -> lari.
function speedFromMagnitude(mag) {
  if (mag < 0.08) return 0
  if (mag < 0.6) return PLAYER.walkSpeed * (mag / 0.6)
  return PLAYER.walkSpeed + (PLAYER.runSpeed - PLAYER.walkSpeed) * Math.min(1, (mag - 0.6) / 0.35)
}

// input: { moveX, moveY, jump }  moveX kanan+, moveY maju+ (relatif kamera)
// camYaw: azimuth kamera (kamera di posisi target + (sin yaw, ., cos yaw))
export function stepPlayer(p, input, dt, world, camYaw) {
  dt = Math.min(dt, 1 / 30)
  const P = PLAYER
  p.justJumped = false

  // ---- lompat (dengan coyote time + jump buffer) ---------------------------
  p.jumpBuf = input.jump ? P.jumpBuffer : Math.max(0, p.jumpBuf - dt)
  input.jump = false // tombol dikonsumsi
  p.coyote = p.grounded ? P.coyoteTime : Math.max(0, p.coyote - dt)
  if (p.jumpBuf > 0 && p.coyote > 0) {
    p.vy = P.jumpSpeed
    p.grounded = false
    p.coyote = 0
    p.jumpBuf = 0
    p.justJumped = true
  }

  // ---- kecepatan horizontal -------------------------------------------------
  const mx = input.moveX || 0, my = input.moveY || 0
  const mag = Math.min(1, Math.hypot(mx, my))
  // maju kamera = (-sin yaw, -cos yaw), kanan kamera = (cos yaw, -sin yaw)
  const sn = Math.sin(camYaw), cs = Math.cos(camYaw)
  let dirX = 0, dirZ = 0
  if (mag > 0.001) {
    dirX = (cs * mx - sn * my) / mag
    dirZ = (-sn * mx - cs * my) / mag
  }
  const wish = speedFromMagnitude(mag)
  const k = 1 - Math.exp(-(p.grounded ? P.groundAccel : P.airAccel) * dt)
  p.vx += (dirX * wish - p.vx) * k
  p.vz += (dirZ * wish - p.vz) * k

  // ---- gerak horizontal + tabrakan tembok ------------------------------------
  const startX = p.x, startZ = p.z
  const wall = world.resolveWalls(startX + p.vx * dt, startZ + p.vz * dt, p.y, P.radius, P.height)
  let nx = wall.x, nz = wall.z

  // ---- vertikal --------------------------------------------------------------
  let newY = p.y
  if (!p.grounded) {
    p.vy = Math.max(p.vy - P.gravity * dt, -P.maxFall)
    newY = p.y + p.vy * dt
  }
  // batas atas pijakan yang terjangkau (tambah jarak jatuh biar gak tembus)
  const reach = p.y + P.stepUp + (p.grounded ? 0 : Math.max(0, -p.vy * dt))

  function blockedBy(gy, tx, tz) {
    if (gy === null) return true // laut / tepi dunia
    const rise = gy - p.y
    if (rise <= P.curbRise) return false
    const dist = Math.hypot(tx - startX, tz - startZ)
    return rise > P.maxSlopeRise * dist + 0.05 // terlalu curam = tebing
  }

  let gy = world.groundY(nx, nz, reach)
  if (blockedBy(gy, nx, nz)) {
    // coba geser cuma di sumbu X atau Z (biar bisa "menyusuri" tepi)
    const tryX = world.resolveWalls(nx, startZ, p.y, P.radius, P.height)
    const gyX = world.groundY(tryX.x, tryX.z, reach)
    const tryZ = world.resolveWalls(startX, nz, p.y, P.radius, P.height)
    const gyZ = world.groundY(tryZ.x, tryZ.z, reach)
    const okX = !blockedBy(gyX, tryX.x, tryX.z)
    const okZ = !blockedBy(gyZ, tryZ.x, tryZ.z)
    if (okX && (!okZ || Math.abs(nx - startX) >= Math.abs(nz - startZ))) {
      nx = tryX.x; nz = tryX.z; gy = gyX; p.vz = 0
    } else if (okZ) {
      nx = tryZ.x; nz = tryZ.z; gy = gyZ; p.vx = 0
    } else {
      nx = startX; nz = startZ; p.vx = 0; p.vz = 0
      gy = world.groundY(nx, nz, reach)
    }
  }

  p.x = nx
  p.z = nz

  if (p.grounded) {
    if (gy === null) {
      // gak ada pijakan sama sekali di tempat berdiri (sangat jarang): jatuh
      p.grounded = false
      p.vy = 0
    } else if (gy < p.y - P.snapDown) {
      p.grounded = false // jalan lewat tepi -> jatuh
      p.vy = 0
    } else {
      p.y = gy // nempel ke tanah (naik/turun mulus)
    }
  } else {
    if (gy !== null && p.vy <= 0 && newY <= gy + 1e-4) {
      p.y = gy // mendarat
      p.vy = 0
      p.grounded = true
    } else {
      p.y = gy !== null && newY < gy ? gy : newY
    }
  }

  // jatuh ke jurang tak berdasar -> balik ke spawn (dijaga pemanggil)
  p.airTime = p.grounded ? 0 : p.airTime + dt

  // ---- arah hadap & laju aktual -------------------------------------------------
  p.speed = Math.hypot(p.vx, p.vz)
  if (p.speed > 0.4) p.yaw = lerpAngle(p.yaw, Math.atan2(p.vx, p.vz), 1 - Math.exp(-14 * dt))
}
