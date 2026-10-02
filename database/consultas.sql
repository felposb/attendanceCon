-- consultas.sql
-- SELECTs que alimentam o wireframe do Figma.
-- Cada "CONSULTA N" desenhada nas telas corresponde ao bloco de mesmo número abaixo.
--
-- Telas:
--   ALUNOS       -> consultas 1 a 4
--   DASHBOARD    -> consultas 5 a 9
--   PROFESSORES  -> consultas 10 a 13
--   CARTOES      -> consultas 14 a 17
--   RELATORIOS   -> consultas 18 a 21
--
-- Os valores entre aspas nas buscas ('%Maria%', 'A1B2C3D4'...) são exemplos:
-- troque pelo texto digitado na tela.
-- Turma é exibida como number || letter (ex.: '1A').


-- ====================================================================
-- ALUNOS
-- ====================================================================

-- CONSULTA 1 - Total estudantes
SELECT COUNT(*) AS total_estudantes
FROM students;

-- CONSULTA 2 - Total estudantes ativos
SELECT COUNT(*) AS total_estudantes_ativos
FROM students
WHERE status = 'ATIVO';

-- CONSULTA 3 - Total estudantes inativos
SELECT COUNT(*) AS total_estudantes_inativos
FROM students
WHERE status = 'INATIVO';

-- CONSULTA 4 - Buscar aluno por nome (nome, cartão, CPF, turma, telefone, endereço, status)
-- Cartões, telefones e endereços ficam em subconsultas para não repetir o aluno
-- quando ele tiver mais de um registro em cards, phones ou adress.
SELECT
  s.id,
  s.name                    AS nome,
  (SELECT string_agg(ca.uid, ', ')
     FROM cards ca
    WHERE ca.id_student = s.id) AS cartao,
  s.cpf,
  c.number || c.letter      AS turma,
  (SELECT string_agg('(' || p.ddd || ') ' || p.number, ', ')
     FROM phones p
    WHERE p.id_student = s.id) AS telefone,
  (SELECT string_agg(a.street || ', ' || a.number || ' - ' || a.neighborhood || ', '
                     || ci.name || '/' || st.uf || ' - CEP ' || a.zip_code, '; ')
     FROM adress a
     JOIN city ci  ON ci.id = a.id_city
     JOIN state st ON st.id = ci.id_state
    WHERE a.id_student = s.id) AS endereco,
  s.status
FROM students s
JOIN enrollments e ON e.id = s.id_enrollment
JOIN class c       ON c.id = e.id_class
WHERE s.name ILIKE '%Maria%'
ORDER BY s.name;


-- ====================================================================
-- DASHBOARD
-- ====================================================================

-- CONSULTA 5 - Total turmas ativas
SELECT COUNT(*) AS total_turmas_ativas
FROM class
WHERE status = 'ATIVO';

-- CONSULTA 6 - Total salas ativas
SELECT COUNT(*) AS total_salas_ativas
FROM classrooms
WHERE status = 'ATIVO';

-- CONSULTA 7 - Total disciplinas ativas
SELECT COUNT(*) AS total_disciplinas_ativas
FROM subjects
WHERE status = 'ATIVO';

-- CONSULTA 8 - Matrículas por status
-- Status sem nenhuma matrícula não aparece no resultado (mostrar 0 na tela).
SELECT status, COUNT(*) AS quantidade
FROM enrollments
GROUP BY status
ORDER BY status;

-- CONSULTA 9 - Últimos alunos cadastrados
SELECT
  s.name                                        AS nome,
  c.number || c.letter                          AS turma,
  to_char(s.data_cadastro, 'DD/MM/YYYY HH24:MI') AS data_cadastro
FROM students s
JOIN enrollments e ON e.id = s.id_enrollment
JOIN class c       ON c.id = e.id_class
ORDER BY s.data_cadastro DESC
LIMIT 5;


-- ====================================================================
-- PROFESSORES
-- Professor = funcionário (employee) com role = 'PROFESSOR'.
-- Se o cargo for gravado com outro texto, ajuste o filtro.
-- ====================================================================

-- CONSULTA 10 - Total professores
SELECT COUNT(*) AS total_professores
FROM employee
WHERE role = 'PROFESSOR';

-- CONSULTA 11 - Total professores ativos
SELECT COUNT(*) AS total_professores_ativos
FROM employee
WHERE role = 'PROFESSOR'
  AND status = 'ATIVO';

-- CONSULTA 12 - Total professores inativos
SELECT COUNT(*) AS total_professores_inativos
FROM employee
WHERE role = 'PROFESSOR'
  AND status = 'INATIVO';

-- CONSULTA 13 - Buscar professor por nome (nome, CPF, cargo, telefone, nascimento, turmas, status)
SELECT
  e.id,
  e.nome,
  e.cpf,
  e.role                              AS cargo,
  e.phone                             AS telefone,
  to_char(e.birth_date, 'DD/MM/YYYY') AS nascimento,
  (SELECT string_agg(c.number || c.letter, ', ' ORDER BY c.number, c.letter)
     FROM teacher_classes tc
     JOIN class c ON c.id = tc.id_class
    WHERE tc.id_employee = e.id) AS turmas,
  e.status
FROM employee e
WHERE e.role = 'PROFESSOR'
  AND e.nome ILIKE '%Carlos%'
ORDER BY e.nome;


-- ====================================================================
-- CARTOES
-- ====================================================================

-- CONSULTA 14 - Total cartões
SELECT COUNT(*) AS total_cartoes
FROM cards;

-- CONSULTA 15 - Alunos com cartão
SELECT COUNT(DISTINCT id_student) AS alunos_com_cartao
FROM cards;

-- CONSULTA 16 - Alunos ativos sem cartão
SELECT COUNT(*) AS alunos_ativos_sem_cartao
FROM students s
WHERE s.status = 'ATIVO'
  AND NOT EXISTS (SELECT 1 FROM cards ca WHERE ca.id_student = s.id);

-- CONSULTA 17 - Buscar por UID do cartão (UID, aluno, CPF, turma, matrícula, status matrícula, status aluno)
SELECT
  ca.uid,
  s.name                       AS aluno,
  s.cpf,
  c.number || c.letter         AS turma,
  array_to_string(e.number, '') AS matricula,
  e.status                     AS status_matricula,
  s.status                     AS status_aluno
FROM cards ca
JOIN students s    ON s.id = ca.id_student
JOIN enrollments e ON e.id = s.id_enrollment
JOIN class c       ON c.id = e.id_class
WHERE ca.uid = 'A1B2C3D4';


-- ====================================================================
-- RELATORIOS
-- ====================================================================

-- CONSULTA 18 - Alunos por turma (só matrículas ATIVAS de alunos ATIVOS)
SELECT
  c.number || c.letter AS turma,
  COUNT(s.id)          AS qtd_alunos
FROM class c
LEFT JOIN enrollments e ON e.id_class = c.id AND e.status = 'ATIVA'
LEFT JOIN students s    ON s.id_enrollment = e.id AND s.status = 'ATIVO'
WHERE c.status = 'ATIVO'
GROUP BY c.id, c.number, c.letter
ORDER BY c.number, c.letter;

-- CONSULTA 19 - Grade de horários (turma, sala, horário)
SELECT
  c.number || c.letter                                    AS turma,
  'Bloco ' || r.block || ' - Sala ' || trim_scale(r.number) AS sala,
  to_char(cc.time, 'HH24:MI')                             AS horario
FROM class_classrooms cc
JOIN class c      ON c.id = cc.id_class
JOIN classrooms r ON r.id = cc.id_classroom
WHERE c.status = 'ATIVO'
ORDER BY c.number, c.letter, cc.time;

-- CONSULTA 20 - Disciplinas por turma (turma, disciplina, horas)
SELECT
  c.number || c.letter AS turma,
  sb.nome              AS disciplina,
  sb.hours             AS horas
FROM class_subjects cs
JOIN class c     ON c.id = cs.id_class
JOIN subjects sb ON sb.id = cs.id_subject
WHERE c.status = 'ATIVO'
  AND sb.status = 'ATIVO'
ORDER BY c.number, c.letter, sb.nome;

-- CONSULTA 21 - Alunos ativos por cidade (UF, cidade, qtd alunos)
SELECT
  st.uf,
  ci.name                      AS cidade,
  COUNT(DISTINCT a.id_student) AS qtd_alunos
FROM adress a
JOIN city ci    ON ci.id = a.id_city
JOIN state st   ON st.id = ci.id_state
JOIN students s ON s.id = a.id_student
WHERE s.status = 'ATIVO'
GROUP BY st.uf, ci.name
ORDER BY qtd_alunos DESC, st.uf, ci.name;
