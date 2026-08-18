# 📡 Smart Attendance System (RFID + IoT)

Um sistema ciberfísico completo de ponta a ponta projetado para automatizar o registro de chamadas e o controle de frequência escolar/institucional utilizando microcontroladores, tecnologia RFID e uma arquitetura web escalável.

Este projeto conecta o mundo físico ao digital: os dados lidos pelos cartões magnéticos (Hardware) são processados e consolidados em um painel de gestão na nuvem (Software).

## 🚀 O Projeto

O controle tradicional de chamadas consome tempo de aula e é suscetível a erros. Este sistema resolve esse problema integrando um leitor RFID a um microcontrolador ESP32. Quando um aluno aproxima sua tag/cartão, o sistema:
1. Lê o UID único do cartão via MFRC522.
2. Transmite o dado para a rede.
3. Valida no backend quem é o aluno, qual é a turma, o horário da disciplina e se a presença é válida.
4. Registra tudo em um banco de dados relacional e exibe em um painel web.

## 🛠️ Stack Tecnológica (Arquitetura)

### Hardware (Camada de Borda/Edge)
*   **Microcontrolador:** ESP32 (utilizando Wi-Fi nativo)
*   **Módulo Leitor:** MFRC522 (Tecnologia RFID 13.56MHz)
*   **Linguagem do Firmware:** C/C++ (via Arduino IDE / PlatformIO)
*   **Comunicação:** Protocolo SPI (Hardware) e HTTP/REST (Rede)

### Software (Camada de Lógica e Dados)
*   **Backend:** Python 
*   **Armazenamento Atual (Protótipo):** Arquitetura baseada em arquivos estáticos (JSON) garantindo o funcionamento e relacionamento CRUD das entidades lógicas (Alunos, Turmas, Matrículas, Logs de Presença).
*   **Armazenamento Definitivo (Em Desenvolvimento):** Migração estruturada para **PostgreSQL** para integridade relacional.
*   **Acesso Web (Futuro):** API Rest e Dashboard Administrativo para professores e gestão pedagógica.

## 🗂️ Estrutura de Entidades (Modelagem de Dados)

O sistema foi modelado considerando as regras de negócio de uma instituição de ensino. As principais entidades (atualmente prototipadas em JSON e prontas para migração SQL) incluem:

*   `students`: Dados cadastrais dos alunos.
*   `classes` / `classrooms`: Gestão de turmas e salas de aula físicas.
*   `subjects` / `teacher_classes`: Disciplinas e grade de professores.
*   `enrollments`: Tabela associativa vinculando alunos às suas respectivas turmas.
*   `cards`: Vínculo direto de um UID de hardware a um ID de aluno.
*   `attendance` / `attendance_logs`: O motor principal do sistema, cruzando os *timestamps* do leitor físico com a grade de horários.

## 🗺️ Roadmap de Desenvolvimento

O projeto está sendo construído em fases evolutivas para garantir a consistência técnica em cada camada:

- [x] **Fase 1: Motor Lógico (Backend Local):** Desenvolvimento do ecossistema CRUD em Python (DRY, validações lógicas e persistência em JSON).
- [ ] **Fase 2: Integração Ciberfísica:** Programação do firmware ESP32 em C/C++ para leitura do módulo MFRC522 e disparo dos payloads.
- [ ] **Fase 3: Modelagem Relacional:** Transição das entidades do JSON para um banco de dados robusto no PostgreSQL (PKs, FKs, Triggers de horário).
- [ ] **Fase 4: API e Interface Web:** Construção dos *endpoints* da web e painel front-end para visualização e gerenciamento do sistema.

## ⚙️ Como executar o protótipo lógico (Python)

1. Clone este repositório:
   ```bash
   git clone [https://github.com/felposb/attendanceCon.git](https://github.com/felposb/attendanceCon.git)
