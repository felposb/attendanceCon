# 📸 Face Scan 3D

App web (celular ou notebook) que escaneia o rosto no estilo do cadastro do Face ID:

1. **Frente** — o rosto dentro do círculo, olhando para a câmera.
2. **Perfis e círculo** — setas na tela, instruções por voz, vibração e bipes estéreo indicam para onde virar
   (esquerda, direita, cima, baixo e diagonais). Enquanto a pose não é atingida, ele continua dando os toques.
3. **Resultado** — rosto 3D texturizado para girar, inspetor de pontos e exportação.

Há dois modos de captura:

- **Câmera ao vivo** — o guia contínuo acima (precisa de HTTPS ou localhost).
- **Fotos passo a passo** — uma foto por pose (frente, perfil esquerdo, perfil direito, cima, baixo). A cada
  foto o app diz se a pose ficou boa ou para onde virar mais antes de tirar de novo. No celular o botão abre a
  câmera; funciona mesmo sem HTTPS e onde a câmera ao vivo é bloqueada.

## O que é calculado

| Item | Detalhe |
| --- | --- |
| Pontos | 478 landmarks 3D por foto (MediaPipe Face Landmarker: 468 da malha + 10 da íris) |
| Vistas | até 9 fotos: frente, perfil esquerdo/direito, cima, baixo e 4 diagonais |
| Fusão 3D | Procrustes generalizado ponderado pela visibilidade de cada ponto em cada foto |
| Malha | topologia canônica (898 triângulos) + 1 subdivisão de Loop (3.592 triângulos) |
| Textura | atlas UV 1024² misturando as fotos, com z-buffer por vista e compensação de exposição |
| Vetor por ponto | **2.362 dimensões**: 40 geométricas + 9 vistas × 258 (visibilidade, histograma de gradientes 4×4×8 estilo SIFT, recorte 8×8, LBP uniforme 59 bins, cor) |
| Template | 478 × 2.362 = **1.129.036 valores float32** |

A escala em mm é estimada assumindo distância interpupilar de 63 mm.

## Como abrir

A câmera do navegador só funciona em **HTTPS** ou em **http://localhost**.

**No notebook** (a partir da raiz do repositório):

```bash
python face_scan/server.py
```

Abra http://localhost:8000.

**No celular** (mesma rede Wi-Fi do computador; precisa do `openssl`, que vem com o Git for Windows):

```bash
python face_scan/server.py --https
```

Abra no celular o endereço `https://<ip-do-computador>:8443` mostrado no terminal e aceite o aviso do
certificado autoassinado.

Sem certificado, dá para usar no celular só o modo **fotos passo a passo**:
`python face_scan/server.py --host 0.0.0.0` e abra `http://<ip-do-computador>:8000`.

Uma página pode ajustar a configuração definindo `window.FACE_SCAN_CONFIG` antes de carregar `js/app.js`
(ex.: `{ photoOnly: true, wasmBase: 'mp', modelUrl: 'mp/face_landmarker.task' }` para servir o modelo e o
WebAssembly do MediaPipe localmente, sem CDN). Veja `js/config.js`.

Também dá para publicar só a pasta `face_scan/` em qualquer hospedagem estática com HTTPS
(GitHub Pages, Vercel, Netlify); nesse caso o botão "Salvar no sistema de chamada" fica oculto e os
arquivos são apenas baixados.

## Integração com o AttendanceCon

Quando aberto pelo `server.py`, o resultado pode ser salvo vinculado a um aluno de `entities/students.json`:

- `entities/faces.json` — cadastro (id, id_student, data, dimensões, vistas, caminhos)
- `entities/faces/face_<id>.json` — landmarks 3D, normais, medidas e poses
- `entities/faces/face_<id>.bin` — vetores float32 little-endian (478 × 2.362)
- `entities/faces/face_<id>.png` — textura do rosto

As funções ficam em `services/faces.py` (`register_face`, `update_face`, `delete_face`, `list_faces`,
`search_face_by_student`, `load_descriptors`). A pasta `entities/faces/` está no `.gitignore`: são dados
biométricos (dado pessoal sensível pela LGPD) e não devem ir para o repositório.

## Limitações

- É uma câmera comum (RGB): a profundidade vem do modelo de IA + fusão das vistas, não de um sensor de
  profundidade como o do Face ID. Não há prova de vida contra fotos/vídeos.
- MediaPipe perde precisão acima de ~60° de rotação, por isso os "perfis" são de ~35–45°.
- O vetor é feito de descritores clássicos (gradientes, LBP, cor, geometria), bom para mapear e comparar
  detalhes, mas não é um modelo de reconhecimento facial treinado.

## Testes

```bash
cd face_scan && node --test "tests/*.test.mjs"
```
