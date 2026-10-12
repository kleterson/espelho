const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração temporária para testes
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://exemplo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'chave_falsa_teste';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Em vez de procurar apenas na raiz (__dirname), mandamos procurar dentro da pasta 'www'
app.use(express.static(path.join(__dirname, 'www')));
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// --- AUTENTICAÇÃO / LOGIN ---
app.post('/api/login', async (req, res) => {
    const { nome, senha } = req.body;
    
    // Verificar se o utilizador já existe
    let { data: user, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('nome', nome)
        .single();

    if (!user) {
        // Se não existir, cria automaticamente como funcionário (ou admin se for o primeiro)
        const cargo = nome.toLowerCase() === 'admin' ? 'admin' : 'funcionario';
        const { data: newUser, err } = await supabase
            .from('usuarios')
            .insert([{ nome, senha, cargo }])
            .select()
            .single();
        
        if (err) return res.status(500).json({ error: err.message });
        return res.json(newUser);
    }

    if (user.senha !== senha) {
        return res.status(401).json({ error: 'Senha incorreta!' });
    }

    res.json(user);
});

// Listar todos os utilizadores (para o Admin)
app.get('/api/usuarios', async (req, res) => {
    const { data, error } = await supabase.from('usuarios').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// --- PONTOS ---
app.get('/api/pontos/:usuario_id', async (req, res) => {
    const { usuario_id } = req.params;
    const { data, error } = await supabase
        .from('pontos')
        .select('*')
        .eq('usuario_id', usuario_id);
    
    if (error) return res.status(500).json({ error: error.message });
    const result = {};
    data.forEach(r => { result[r.data] = r; });
    res.json(result);
});

app.post('/api/pontos', async (req, res) => {
    const { usuario_id, data, entrada, pausa, retorno, saida, foto } = req.body;
    
    // Upsert baseado em usuario_id e data
    const { error } = await supabase
        .from('pontos')
        .upsert({ usuario_id, data, entrada, pausa, retorno, saida, foto }, { onConflict: 'usuario_id,data' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: 'ok' });
});

// Admin lançar folga/atestado
app.post('/api/admin/lancar-status', async (req, res) => {
    const { usuario_id, data, status } = req.body;
    const { error } = await supabase
        .from('pontos')
        .upsert({ 
            usuario_id, 
            data, 
            entrada: status, 
            pausa: status, 
            retorno: status, 
            saida: status, 
            foto: null 
        }, { onConflict: 'usuario_id,data' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: 'ok' });
});

app.delete('/api/pontos/:usuario_id/:mes', async (req, res) => {
    const { usuario_id, mes } = req.params; // AAAA-MM
    // Apaga os pontos do mês para o utilizador específico
    const { data, error } = await supabase
        .from('pontos')
        .delete()
        .eq('usuario_id', usuario_id)
        .like('data', `${mes}-%`);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: 'ok' });
});

// --- SOLICITAÇÕES ---
app.get('/api/solicitacoes', async (req, res) => {
    const { data, error } = await supabase
        .from('solicitacoes')
        .select('*, usuarios(nome)')
        .eq('status', 'pendente');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/solicitacoes', async (req, res) => {
    const { usuario_id, funcionario, data, tipo, horario, motivo } = req.body;
    const { error } = await supabase
        .from('solicitacoes')
        .insert([{ usuario_id, funcionario, data, tipo, horario, motivo, status: 'pendente' }]);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: 'ok' });
});

app.post('/api/solicitacoes/responder', async (req, res) => {
    const { id, acao, usuario_id, data, tipo, horario } = req.body;
    
    const { error } = await supabase
        .from('solicitacoes')
        .update({ status: acao })
        .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    if (acao === 'aceito') {
        // Buscar ponto atual ou criar novo
        let { data: p } = await supabase.from('pontos').select('*').eq('usuario_id', usuario_id).eq('data', data).single();
        if (!p) {
            p = { usuario_id, data, entrada: '-', pausa: '-', retorno: '-', saida: '-', foto: null };
        }
        p[tipo] = horario;

        await supabase.from('pontos').upsert(p, { onConflict: 'usuario_id,data' });
    }

    res.json({ status: 'ok' });
});

// Endpoint global para o admin ver todos os registos
app.get('/api/admin/todos-pontos', async (req, res) => {
    const { data, error } = await supabase.from('pontos').select('*, usuarios(nome)');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor a correr na porta ${PORT}`);
});